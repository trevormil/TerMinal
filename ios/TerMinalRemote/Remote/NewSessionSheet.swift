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

    // Engines TerMinal can launch. Kept in step with EngineId in settings.ts.
    private let engines = ["claude", "codex", "cursor", "local"]

    private var shown: [RepoOption] {
        filter.isEmpty
            ? repos
            : repos.filter { $0.name.localizedCaseInsensitiveContains(filter) }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                GT.bg.ignoresSafeArea()
                VStack(alignment: .leading, spacing: 12) {
                    Picker("Engine", selection: $engine) {
                        ForEach(engines, id: \.self) { Text($0).tag($0) }
                    }
                    .pickerStyle(.segmented)

                    TextField("What should it do? (optional)", text: $task, axis: .vertical)
                        .lineLimit(1...4)
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
                        .font(GT.sans(13))
                        .foregroundStyle(GT.text)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 7)
                        .background(Color.black.opacity(0.35))
                        .clipShape(RoundedRectangle(cornerRadius: 8))

                    if let error {
                        Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow)
                    }

                    ScrollView {
                        LazyVStack(spacing: 8) {
                            ForEach(shown) { repo in
                                Button {
                                    selected = repo
                                    Task { await start(repo) }
                                } label: {
                                    GTPanel(padding: 11) {
                                        HStack {
                                            Text(repo.name)
                                                .font(GT.sans(14, .medium))
                                                .foregroundStyle(GT.text)
                                            Spacer()
                                            if busy && selected == repo {
                                                ProgressView().tint(GT.accentLight).scaleEffect(0.7)
                                            } else {
                                                Image(systemName: "arrow.up.forward.app")
                                                    .font(.system(size: 12))
                                                    .foregroundStyle(GT.textFaint)
                                            }
                                        }
                                    }
                                }
                                .buttonStyle(.plain)
                                .disabled(busy)
                            }
                        }
                    }
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
            }
            .task {
                do { repos = try await client.repos() } catch {
                    self.error = error.localizedDescription
                }
            }
        }
        .preferredColorScheme(.dark)
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
