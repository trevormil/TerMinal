import SwiftUI

/// Reads from the shared RemoteFeed (polled once at the app root) rather than
/// running its own fetch loop against the same endpoint.
@Observable
final class InboxViewModel {
    let feed: RemoteFeed
    private var client: BridgeClient { feed.client }

    init(feed: RemoteFeed) { self.feed = feed }

    var hitl: [HitlItem] { feed.hitl }
    // One axis: unread vs read. No archive. Newest first.
    var items: [HitlItem] { hitl.sorted { $0.createdAt > $1.createdAt } }
    var error: String? { feed.error }
    var loading: Bool { feed.loading }

    var unread: [HitlItem] { hitl.filter(\.isUnread) }

    // MARK: Categories (ticket 121)

    private static let categoryKey = "inboxCategory"

    /// Persisted so the phone reopens where you left it.
    ///
    /// A plain observed property backed by UserDefaults, NOT `@AppStorage`.
    /// `@AppStorage` is a `DynamicProperty` that only republishes from a View;
    /// inside an `@Observable` class it has to be `@ObservationIgnored`, and
    /// then selecting a category persists the choice but never notifies —
    /// the list keeps rendering the old filter. It compiles and looks right.
    private var storedCategory: String = UserDefaults.standard
        .string(forKey: InboxViewModel.categoryKey) ?? InboxCategories.all
    {
        didSet { UserDefaults.standard.set(storedCategory, forKey: Self.categoryKey) }
    }

    var categories: [InboxCategories.CategoryCount] { InboxCategories.derive(items) }

    /// The selection actually in force. Never trust the stored value directly:
    /// the category it names can be gone, and a filter matching nothing reads
    /// as a sync failure rather than an empty category.
    var activeCategory: String {
        get { InboxCategories.resolveSelection(storedCategory, categories) }
        set { storedCategory = newValue }
    }

    var showFilter: Bool { InboxCategories.shouldShowFilter(categories) }

    /// What the list renders — the one definition both the rows and the
    /// bulk actions read, so they can never disagree about what is on screen.
    var shown: [HitlItem] { InboxCategories.filter(items, activeCategory) }

    @MainActor
    func refresh() async { await feed.refresh() }

    /// Mark read — optimistic locally, persisted + badge-synced in the background.
    @MainActor
    func markRead(_ items: [HitlItem]) {
        let ids = items.filter(\.isUnread).map(\.id)
        guard !ids.isEmpty else { return }
        feed.markHitlRead(ids: ids)
        Task { try? await client.markHitlRead(ids: ids) }
    }

    /// Back on the unread pile — email "keep this on my plate".
    @MainActor
    func markUnread(_ item: HitlItem) {
        guard !item.isUnread else { return }
        feed.markHitlRead(ids: [item.id], read: false)
        Task { try? await client.markHitlRead(ids: [item.id], read: false) }
    }

    /// Reads what is ON SCREEN, not the whole inbox. The scoping decision lives
    /// in `InboxCategories.bulkReadTargets`, where it is unit-tested.
    @MainActor
    func markAllRead() { markRead(InboxCategories.bulkReadTargets(items, activeCategory)) }
}

/// Global, cross-workspace: everything that needs you, read like email — a list
/// of subjects; tap one to read the full body.
struct InboxView: View {
    @State var model: InboxViewModel
    var onSettings: () -> Void
    /// Item a tapped notification named. The list scrolls to it once loaded so
    /// the alert lands on the thing it was about, not just the tab.
    var focusedId: String?

    private var shown: [HitlItem] { model.shown }

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            // A real List (not a LazyVStack) so rows get native swipe actions.
            ScrollViewReader { proxy in
            List {
                if let error = model.error {
                    GTPanel { Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow) }
                        .plainRow()
                }
                if shown.isEmpty && !model.loading {
                    GTPanel {
                        // An empty CATEGORY is not an empty inbox. Saying
                        // "Inbox zero" while a filter hides twelve items is a
                        // lie the user has no way to spot.
                        Text(model.activeCategory == InboxCategories.all
                            ? "Inbox zero."
                            : "Nothing in \(model.activeCategory).")
                            .font(GT.sans(12)).foregroundStyle(GT.textMuted)
                    }
                    .plainRow()
                }
                ForEach(shown) { item in
                    // Chevron lives INSIDE the card (InboxRow draws it); the
                    // native List accessory is suppressed by hiding the link.
                    InboxRow(item: item)
                        .id(item.id)
                        .background(
                            NavigationLink {
                                InboxDetailView(item: item, model: model)
                                    .onAppear { model.markRead([item]) }
                            } label: { EmptyView() }
                            .opacity(0)
                        )
                        .plainRow()
                        .swipeActions(edge: .leading, allowsFullSwipe: true) {
                            if item.isUnread {
                                Button {
                                    model.markRead([item])
                                } label: {
                                    Label("Read", systemImage: "envelope.open")
                                }
                                .tint(GT.accent)
                            } else {
                                Button {
                                    model.markUnread(item)
                                } label: {
                                    Label("Unread", systemImage: "envelope.badge")
                                }
                                .tint(GT.accent)
                            }
                        }
                        .contextMenu {
                            if item.isUnread {
                                Button("Mark read", systemImage: "envelope.open") {
                                    model.markRead([item])
                                }
                            } else {
                                Button("Mark unread", systemImage: "envelope.badge") {
                                    model.markUnread(item)
                                }
                            }
                        }
                }
            }
            .onChange(of: focusedId) { _, id in scrollTo(id, proxy) }
            .onChange(of: model.items.count) { _, _ in scrollTo(focusedId, proxy) }
            .task { scrollTo(focusedId, proxy) }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            // List reserves its own default top content margin regardless of
            // the first row's insets — contentMargins is the one API that
            // actually sets it, matching Workspaces' 14pt VStack padding
            // exactly instead of stacking on top of a default we don't see.
            .contentMargins(.top, 10, for: .scrollContent)
            .overlay { if model.loading { ProgressView().tint(GT.accentLight) } }
            .refreshable { await model.refresh() }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            GTPinnedHeader(title: "Inbox") {
                HStack(spacing: 14) {
                    if model.showFilter { CategoryMenu(model: model) }
                    // Scoped to the visible category, so the label cannot offer
                    // to read items the filter is hiding.
                    if shown.contains(where: \.isUnread) {
                        Button("Read all") { model.markAllRead() }.font(GT.sans(13))
                    }
                    Button(action: onSettings) { Image(systemName: "gearshape") }
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
    }

    /// Bring a notification's item into view once the feed contains it. A no-op
    /// when the id is absent — the alert still landed on the Inbox, which is
    /// the point.
    private func scrollTo(_ id: String?, _ proxy: ScrollViewProxy) {
        guard let id, model.items.contains(where: { $0.id == id }) else { return }
        withAnimation { proxy.scrollTo(id, anchor: .center) }
    }
}

/// The phone's answer to the desktop sidebar.
///
/// A 160pt rail on a 390pt screen is most of the width, so the same derived
/// list becomes a menu instead. Identical rules, different affordance — the
/// selection, the counts, and the ordering all come from `InboxCategories`.
private struct CategoryMenu: View {
    @Bindable var model: InboxViewModel

    var body: some View {
        Menu {
            // A Picker inside a Menu gets the native checkmark on the active
            // row for free, which is the whole reason to prefer it here.
            Picker("Category", selection: Binding(
                get: { model.activeCategory },
                set: { model.activeCategory = $0 }
            )) {
                ForEach(model.categories) { c in
                    // Nesting shows as an indented leaf, not a full path — a
                    // row reading `Monitoring/Certs` directly under `Monitoring`
                    // says the parent's name twice. A Menu row cannot take
                    // padding, so the indent is literal; figure spaces (U+2007)
                    // are fixed-width, so it stays aligned in a proportional font.
                    Text(
                        String(
                            repeating: "\u{2007}\u{2007}",
                            count: InboxCategories.depth(of: c.name)
                        ) + "\(InboxCategories.leaf(of: c.name)) (\(c.count))"
                    ).tag(c.name)
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "line.3.horizontal.decrease.circle")
                if model.activeCategory != InboxCategories.all {
                    // The leaf alone would be ambiguous here — two branches can
                    // both end in `Certs`, and this is the only place the
                    // current filter is named.
                    Text(model.activeCategory).font(GT.sans(13))
                }
            }
        }
        .tint(GT.accent)
    }
}

/// One subject line — bold when unread, a severity tag, source + time. No body.
private struct InboxRow: View {
    let item: HitlItem
    var body: some View {
        GTPanel(padding: 11) {
            HStack(spacing: 8) {
                Circle()
                    .fill(item.isUnread ? GT.accent : Color.clear)
                    .frame(width: 6, height: 6)
                VStack(alignment: .leading, spacing: 2) {
                    Text(inlineMarkdown(item.title))
                        .font(GT.sans(14, item.isUnread ? .semibold : .medium))
                        .foregroundStyle(item.isUnread ? GT.text : GT.textMuted)
                        .lineLimit(1)
                    HStack(spacing: 5) {
                        Text(item.source).font(GT.mono(10)).foregroundStyle(GT.textFaint)
                        if let repo = item.repo, !repo.isEmpty {
                            Text("· \(repo)").font(GT.mono(10)).foregroundStyle(GT.textFaint)
                        }
                        Text("· \(relativeTime(item.createdAt))")
                            .font(GT.mono(10)).foregroundStyle(GT.textFaint)
                    }
                    .lineLimit(1)
                }
                Spacer(minLength: 4)
                SeverityTag(severity: item.severity)
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(GT.textFaint)
            }
        }
    }
}

/// The opened email: full body rendered as Markdown. Opening marks read; the
/// only action is to put it back on the unread pile.
private struct InboxDetailView: View {
    let item: HitlItem
    let model: InboxViewModel
    @Environment(\.dismiss) private var dismiss

    private var live: HitlItem { model.hitl.first { $0.id == item.id } ?? item }

    private var body_: String {
        [item.action, item.detail].compactMap { $0 }.filter { !$0.isEmpty }
            .joined(separator: "\n\n")
    }

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(inlineMarkdown(item.title)).font(GT.sans(18, .semibold)).foregroundStyle(GT.text)
                    HStack(spacing: 6) {
                        SeverityTag(severity: item.severity)
                        Text(item.source).font(GT.mono(11)).foregroundStyle(GT.textFaint)
                        if let repo = item.repo, !repo.isEmpty {
                            Text("· \(repo)").font(GT.mono(11)).foregroundStyle(GT.textFaint)
                        }
                        Text("· \(relativeTime(item.createdAt))")
                            .font(GT.mono(11)).foregroundStyle(GT.textFaint)
                    }
                    if body_.isEmpty {
                        Text("No details.").font(GT.sans(13)).foregroundStyle(GT.textMuted)
                    } else {
                        MarkdownText(raw: body_)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
            }
        }
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    model.markUnread(live)
                    dismiss()
                } label: {
                    Label("Mark unread", systemImage: "envelope.badge")
                }
            }
        }
    }
}

/// 3-tier severity tag; legacy 'push' reads as urgent.
private struct SeverityTag: View {
    let severity: String?
    private var tier: (String, Color) {
        switch severity {
        case "normal": return ("Normal", GT.accentLight)
        case "low": return ("Low", GT.textFaint)
        default: return ("Urgent", GT.yellow)  // 'urgent' | legacy 'push' | nil
        }
    }
    var body: some View {
        // "normal" is the common tier — a constant tag on nearly every row is
        // noise. Only urgent/low carry scanning signal.
        if severity != "normal" {
            Text(tier.0)
                .font(GT.sans(9, .semibold))
                .foregroundStyle(tier.1)
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(tier.1.opacity(0.12))
                .clipShape(Capsule())
        }
    }
}
