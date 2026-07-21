import SwiftUI

/// Start a session on the Mac from the phone, so the app isn't merely a viewer
/// of sessions you started at the desk.
struct NewSessionSheet: View {
    let client: BridgeClient
    let onStarted: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var repos: [RepoOption] = []
    @State private var filter = ""
    @State private var engine = "codex"
    @State private var busy = false
    @State private var error: String?

    // Engines TerMinal can launch interactively. Kept in step with EngineId in
    // src/main/settings.ts.
    private let engines = ["codex", "claude", "cursor", "local"]

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

                    TextField("Filter repos", text: $filter)
                        .font(GT.sans(14))
                        .foregroundStyle(GT.text)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 9)
                        .background(Color.black.opacity(0.35))
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                        .overlay(RoundedRectangle(cornerRadius: 10).stroke(GT.border, lineWidth: 1))

                    if let error {
                        Text(error).font(GT.sans(12)).foregroundStyle(GT.yellow)
                    }

                    ScrollView {
                        LazyVStack(spacing: 8) {
                            ForEach(shown) { repo in
                                Button {
                                    Task { await start(repo) }
                                } label: {
                                    GTPanel(padding: 11) {
                                        HStack {
                                            Text(repo.name)
                                                .font(GT.sans(14, .medium))
                                                .foregroundStyle(GT.text)
                                            Spacer()
                                            Image(systemName: "arrow.up.right")
                                                .font(.system(size: 11))
                                                .foregroundStyle(GT.textFaint)
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
                if busy { ProgressView().tint(GT.accentLight) }
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
                do { repos = try await client.repos() } catch { self.error = error.localizedDescription }
            }
        }
        .preferredColorScheme(.dark)
    }

    private func start(_ repo: RepoOption) async {
        busy = true
        defer { busy = false }
        do {
            _ = try await client.startSession(cwd: repo.path, engine: engine, name: repo.name)
            await onStarted()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
