import SwiftUI

/// "Today" — the morning briefing, shown at the top of the Inbox tab.
///
/// It lives inside Inbox rather than as a sixth tab for two reasons: the
/// desktop made the same call (the briefing is a section of the Inbox drawer,
/// not a tab of its own), and iOS collapses a sixth tab into a "More" list,
/// which would bury the highest-value AFK surface behind two taps.
@Observable
final class BriefingViewModel {
    let client: BridgeClient
    private(set) var briefing: Briefing?
    private(set) var error: String?
    /// Verdicts recorded on this device but not yet confirmed by a refetch, so
    /// a tap feels instant on a slow tailnet.
    private(set) var pending: [String: String] = [:]

    init(client: BridgeClient) { self.client = client }

    var items: [BriefingItem] {
        sortedBriefingItems(briefing?.items ?? [])
    }

    func verdict(for item: BriefingItem) -> String? { pending[item.id] ?? item.verdict }

    var unreviewedCount: Int { items.filter { verdict(for: $0) == nil }.count }

    @MainActor
    func refresh() async {
        do {
            briefing = try await client.briefing()
            error = nil
        } catch {
            // A briefing failure must never take out the Inbox it renders
            // above — surface it inline and leave the HITL list alone.
            self.error = error.localizedDescription
        }
    }

    @MainActor
    func act(_ item: BriefingItem, _ verdict: String) {
        guard let date = briefing?.date else { return }
        pending[item.id] = verdict
        Task {
            do {
                try await client.actOnBriefing(date: date, itemId: item.id, verdict: verdict)
                await refresh()
            } catch {
                // Roll the optimistic verdict back — pretending a failed write
                // succeeded is how a dismissed idea comes back tomorrow with no
                // explanation.
                pending[item.id] = nil
                self.error = error.localizedDescription
            }
        }
    }
}

struct BriefingSection: View {
    @State var model: BriefingViewModel
    @State private var collapsed = false

    var body: some View {
        // The poll is attached to the Group, NOT to the populated branch. A
        // `.task` on the `if let` branch only starts once that branch exists,
        // and a `.task` on the empty branch is one-shot — so before the first
        // briefing landed, the section would have appeared only when something
        // else caused the Inbox to rebuild. Hoisting it makes the polling
        // identical in both states.
        Group {
            // Render nothing at all until a briefing exists: someone not running
            // the daily automations should see the Inbox exactly as before.
            if let briefing = model.briefing {
                GTPanel {
                    VStack(alignment: .leading, spacing: 8) {
                        header(briefing)
                        if !collapsed {
                            if let summary = briefing.summary, !summary.isEmpty {
                                Text(summary)
                                    .font(GT.sans(12))
                                    .foregroundStyle(GT.textSoft)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            if let error = model.error {
                                Text(error).font(GT.sans(11)).foregroundStyle(GT.yellow)
                            }
                            if model.items.isEmpty {
                                Text(
                                    "The agents ran and produced nothing worth your attention. That is a good morning."
                                )
                                .font(GT.sans(12))
                                .foregroundStyle(GT.textMuted)
                                .fixedSize(horizontal: false, vertical: true)
                            } else {
                                ForEach(model.items) { item in
                                    BriefingRow(item: item, model: model)
                                }
                            }
                        }
                    }
                }
            } else {
                Color.clear.frame(height: 0)
            }
        }
        .task {
            while !Task.isCancelled {
                await model.refresh()
                // The briefing is written once a day, so a slow poll is
                // plenty — no need for the feed's tighter cadence.
                try? await Task.sleep(for: .seconds(120))
            }
        }
    }

    @ViewBuilder
    private func header(_ briefing: Briefing) -> some View {
        Button {
            collapsed.toggle()
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "sunrise").font(.system(size: 12)).foregroundStyle(GT.yellow)
                Text("Today").font(GT.sans(13, .semibold)).foregroundStyle(GT.text)
                Text(briefing.date).font(GT.mono(11)).foregroundStyle(GT.textMuted)
                Spacer()
                if model.unreviewedCount > 0 {
                    Text("\(model.unreviewedCount)")
                        .font(GT.mono(10, .bold))
                        .foregroundStyle(GT.yellow)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(GT.yellow.opacity(0.18), in: Capsule())
                }
                Image(systemName: collapsed ? "chevron.right" : "chevron.down")
                    .font(.system(size: 10)).foregroundStyle(GT.textMuted)
            }
        }
        .buttonStyle(.plain)
    }
}

private struct BriefingRow: View {
    let item: BriefingItem
    let model: BriefingViewModel

    var body: some View {
        let (symbol, tint) = BriefingKind.glyph(item.kind)
        let verdict = model.verdict(for: item)
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: symbol).font(.system(size: 11)).foregroundStyle(tint)
                .padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                Text(item.title)
                    .font(GT.sans(12))
                    .foregroundStyle(verdict == nil ? GT.text : GT.textMuted)
                    .strikethrough(verdict != nil)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 4) {
                    if let repo = item.repo {
                        Text(repo).font(GT.mono(10)).foregroundStyle(GT.textFaint)
                    }
                    if let agent = item.agent {
                        Text("· \(agent)").font(GT.mono(10)).foregroundStyle(GT.textFaint)
                    }
                }
                if let detail = item.detail, !detail.isEmpty {
                    Text(detail).font(GT.sans(11)).foregroundStyle(GT.textMuted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                actions(verdict)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 3)
        .opacity(verdict == nil ? 1 : 0.55)
    }

    @ViewBuilder
    private func actions(_ verdict: String?) -> some View {
        HStack(spacing: 6) {
            if let url = item.externalURL {
                Link(destination: url) {
                    Label("Open", systemImage: "arrow.up.right")
                        .font(GT.sans(10))
                }
                .buttonStyle(.plain)
                .foregroundStyle(GT.accentLight)
            }
            if verdict == nil {
                Button { model.act(item, "promoted") } label: {
                    Label("Promote", systemImage: "checkmark").font(GT.sans(10))
                }
                .buttonStyle(.plain)
                .foregroundStyle(GT.accentLight)

                Button { model.act(item, "dismissed") } label: {
                    Label("Dismiss", systemImage: "xmark").font(GT.sans(10))
                }
                .buttonStyle(.plain)
                .foregroundStyle(GT.textMuted)
            } else {
                Text(verdict!).font(GT.mono(10)).foregroundStyle(GT.textFaint)
            }
        }
        .padding(.top, 1)
    }
}
