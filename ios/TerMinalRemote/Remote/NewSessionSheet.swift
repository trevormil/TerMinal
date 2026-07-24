import SwiftUI

/// Start a session in a KNOWN workspace. Opened from inside a workspace, so the
/// repo is already decided — pick an engine, optionally say what it should do,
/// and go. No repo picker: the workspace you're in is the repo.
struct NewSessionSheet: View {
    let client: BridgeClient
    let repo: RepoOption
    /// Handed the new thread id so the caller can open it immediately.
    let onStarted: (String) async -> Void

    @Environment(\.dismiss) private var dismiss
    // The Mac's list order carries its default; codex only if the list is empty
    // (the repo-wide safe default — never assume claude).
    @State private var engine = WsEngine.fallback.first?.id ?? "codex"
    @State private var task = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var taskFocused: Bool

    // Fetched from the Mac so the list and its casing match the desktop.
    @State private var engines: [WsEngine] = WsEngine.fallback

    var body: some View {
        NavigationStack {
            ZStack {
                GT.bg.ignoresSafeArea().onTapGesture { taskFocused = false }
                VStack(alignment: .leading, spacing: 14) {
                    HStack(spacing: 8) {
                        Image(systemName: repo.isScratch ? "tray.full" : "folder.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(repo.isScratch ? GT.accent2 : GT.accentLight)
                        Text(repo.name).font(GT.sans(16, .semibold)).foregroundStyle(GT.text)
                    }

                    Text("ENGINE")
                        .font(GT.sans(10, .semibold)).tracking(0.8).foregroundStyle(GT.textFaint)
                    // Scrolling chip row, not a segmented control: seven engines
                    // would be unreadable slivers.
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

                    Text("TASK (OPTIONAL)")
                        .font(GT.sans(10, .semibold)).tracking(0.8).foregroundStyle(GT.textFaint)
                    TextField("What should it do?", text: $task, axis: .vertical)
                        .lineLimit(2...6)
                        .focused($taskFocused)
                        .font(GT.sans(14))
                        .foregroundStyle(GT.text)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 9)
                        .background(Color.black.opacity(0.35))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(GT.border, lineWidth: 1))

                    if let error {
                        Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow)
                    }

                    Spacer()

                    Button {
                        Task { await start() }
                    } label: {
                        HStack(spacing: 8) {
                            if busy { ProgressView().tint(.white).scaleEffect(0.8) }
                            Text(busy ? "Starting…" : "Start in \(repo.name)")
                                .font(GT.sans(15, .semibold))
                                .foregroundStyle(.white)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 13)
                        .background(GT.accent)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .disabled(busy)
                }
                .padding(16)
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
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { taskFocused = false }
                }
            }
            .task {
                guard let live = try? await client.engines(), !live.isEmpty else { return }
                // Re-default to the Mac's first engine, but never clobber a
                // selection the user already made.
                let untouched = engine == engines.first?.id
                engines = live
                if untouched, let first = live.first { engine = first.id }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func start() async {
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
