import SwiftUI

/// Start a session on the Mac from the phone. Pick a repo, an engine, and
/// optionally say what it should do — then it appears as a thread you can
/// follow, and as a real tab on the Mac.
struct NewSessionSheet: View {
    let client: BridgeClient
    /// Handed the new thread id so the caller can open it immediately.
    let onStarted: (String) async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var repos: [RepoOption] = []
    @State private var filter = ""
    @State private var engine = "claude"
    @State private var task = ""
    @State private var selected: RepoOption?
    @State private var busy = false
    @State private var error: String?

    // Which text field owns the keyboard, so any of them can be dismissed.
    private enum Field { case task, filter }
    @FocusState private var focus: Field?

    // Fetched from the Mac so the list and its casing always match the desktop
    // (Codex, Self-hosted, …) instead of a stale hardcoded set.
    @State private var engines: [WsEngine] = WsEngine.fallback

    private var shown: [RepoOption] {
        filter.isEmpty
            ? repos
            : repos.filter { $0.name.localizedCaseInsensitiveContains(filter) }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                // Tapping empty space drops the keyboard.
                GT.bg.ignoresSafeArea().onTapGesture { focus = nil }
                VStack(alignment: .leading, spacing: 12) {
                    // A scrolling chip row, not a segmented control: there are
                    // seven engines and segments would be unreadable slivers.
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(engines) { e in
                                Button { engine = e.id } label: {
                                    HStack(spacing: 5) {
                                        EngineLogo(engine: e.id, size: 13)
                                        Text(e.label).font(GT.sans(13, .medium))
                                    }
                                    .foregroundStyle(engine == e.id ? GT.text : GT.textMuted)
                                    .padding(.horizontal, 11)
                                    .padding(.vertical, 7)
                                    .background(engine == e.id ? GT.accent.opacity(0.22) : GT.panel2)
                                    .clipShape(Capsule())
                                    .overlay(
                                        Capsule().stroke(
                                            engine == e.id ? GT.accent : GT.border, lineWidth: 1)
                                    )
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 1)
                    }

                    TextField("What should it do? (optional)", text: $task, axis: .vertical)
                        .lineLimit(1...4)
                        .focused($focus, equals: .task)
                        .font(GT.sans(14))
                        .foregroundStyle(GT.text)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 9)
                        .background(Color.black.opacity(0.35))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(GT.border, lineWidth: 1))

                    Text("REPO")
                        .font(GT.sans(10, .semibold))
                        .tracking(0.8)
                        .foregroundStyle(GT.textFaint)

                    TextField("Filter", text: $filter)
                        .focused($focus, equals: .filter)
                        .font(GT.sans(13))
                        .foregroundStyle(GT.text)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(Color.black.opacity(0.35))
                        .clipShape(RoundedRectangle(cornerRadius: 8))

                    ScrollView {
                        LazyVStack(spacing: 8) {
                            ForEach(shown) { repo in
                                Button {
                                    focus = nil
                                    selected = repo
                                } label: {
                                    repoRow(repo)
                                }
                                .buttonStyle(.plain)
                                .disabled(busy)
                            }
                        }
                    }
                    .scrollDismissesKeyboard(.immediately)

                    if let error {
                        Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow)
                    }

                    startButton
                }
                .padding(14)
            }
            .navigationTitle("New session")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(GT.panel, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { dismiss() }
                }
                // Standard iOS "Done" above the keyboard — always reachable.
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { focus = nil }
                }
            }
            .task {
                do { repos = try await client.repos() } catch {
                    self.error = error.localizedDescription
                }
                // Best-effort: keep the built-in list if the Mac can't serve one.
                if let live = try? await client.engines(), !live.isEmpty { engines = live }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func repoRow(_ repo: RepoOption) -> some View {
        let isSelected = selected == repo
        return GTPanel(padding: 11) {
            HStack {
                Text(repo.name)
                    .font(GT.sans(14, .medium))
                    .foregroundStyle(isSelected ? GT.accentLight : GT.text)
                Spacer()
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 14))
                    .foregroundStyle(isSelected ? GT.accentLight : GT.textFaint)
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(isSelected ? GT.accent : .clear, lineWidth: 1.5)
        )
    }

    private var startButton: some View {
        Button {
            guard let repo = selected else { return }
            Task { await start(repo) }
        } label: {
            HStack(spacing: 8) {
                if busy {
                    ProgressView().tint(.white).scaleEffect(0.8)
                }
                Text(
                    busy
                        ? "Starting…"
                        : (selected.map { "Start \($0.name)" } ?? "Select a repo")
                )
                .font(GT.sans(15, .semibold))
                .foregroundStyle(.white)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 13)
            .background(selected == nil ? GT.borderStrong : GT.accent)
            .clipShape(RoundedRectangle(cornerRadius: 12))
        }
        .disabled(selected == nil || busy)
    }

    private func start(_ repo: RepoOption) async {
        busy = true
        defer { busy = false }
        do {
            let id = try await client.spawn(cwd: repo.path, engine: engine, task: task)
            await onStarted(id)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
