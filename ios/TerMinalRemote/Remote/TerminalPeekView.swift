import SwiftUI

/// Read-only peek at the live terminal behind a remote thread — for when the
/// chat goes quiet and you want to see what the pty is actually doing. The Mac
/// serves the tail of the session's output log (ANSI stripped); this view
/// polls it while visible, same idiom as the thread's message poll.
struct TerminalPeekView: View {
    let sessionId: String
    let client: BridgeClient

    @State private var text = ""
    @State private var loaded = false
    @State private var unavailable = false
    @State private var poll: Task<Void, Never>?

    var body: some View {
        ZStack {
            GT.terminalBg.ignoresSafeArea()
            if unavailable {
                noTerminal
            } else if !loaded {
                ProgressView().tint(GT.textFaint)
            } else {
                output
            }
        }
        .navigationTitle("Terminal")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Text("read-only")
                    .font(GT.sans(10.5))
                    .foregroundStyle(GT.textFaint)
            }
        }
        .onAppear { start() }
        .onDisappear { stop() }
    }

    private var output: some View {
        ScrollViewReader { proxy in
            ScrollView {
                Text(text)
                    .font(GT.mono(11))
                    .foregroundStyle(GT.textSoft)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                Color.clear.frame(height: 1).id("bottom")
            }
            // The newest output is what you came for — land at the bottom and
            // follow it as the poll appends.
            .onAppear { proxy.scrollTo("bottom", anchor: .bottom) }
            .onChange(of: text) { proxy.scrollTo("bottom", anchor: .bottom) }
            .refreshable { await refresh() }
        }
    }

    private var noTerminal: some View {
        VStack(spacing: 10) {
            Image(systemName: "terminal")
                .font(.system(size: 28))
                .foregroundStyle(GT.textFaint)
            Text("No terminal attached — the session may be headless or ended.")
                .font(GT.sans(13))
                .foregroundStyle(GT.textMuted)
                .multilineTextAlignment(.center)
        }
        .padding(28)
    }

    private func start() {
        guard poll == nil else { return }
        poll = Task {
            while !Task.isCancelled {
                await refresh()
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    private func stop() {
        poll?.cancel()
        poll = nil
    }

    @MainActor
    private func refresh() async {
        do {
            let tail = try await client.terminalText(id: sessionId)
            text = tail.text
            loaded = true
            unavailable = false
        } catch BridgeError.sessionGone {
            // A 404 is a real answer: nothing on the Mac maps to this thread.
            unavailable = true
        } catch {
            // Transient network trouble — keep the last snapshot on screen.
        }
    }
}
