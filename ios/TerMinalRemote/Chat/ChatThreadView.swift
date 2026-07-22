import SwiftUI

@Observable
final class ChatThreadViewModel {
    private(set) var messages: [ChatMessage] = []
    private(set) var status = "idle"
    private(set) var unsupported = false
    private(set) var error: String?
    private(set) var loading = true
    private(set) var sending = false

    let thread: ChatThread
    let client: BridgeClient
    private var poll: Task<Void, Never>?

    var isWorking: Bool { status == "working" }

    init(thread: ChatThread, client: BridgeClient) {
        self.thread = thread
        self.client = client
    }

    @MainActor
    func refresh() async {
        defer { loading = false }
        do {
            // Ask only for what we don't have: the transcript of a long session
            // is large and this polls every couple of seconds.
            let page = try await client.messages(key: thread.key, after: messages.count)
            if !page.messages.isEmpty { messages.append(contentsOf: page.messages) }
            status = page.status
            unsupported = page.unsupported
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    func start() {
        guard poll == nil else { return }
        poll = Task { [self] in
            while !Task.isCancelled {
                await refresh()
                try? await Task.sleep(for: .seconds(2))
            }
        }
    }

    func stop() {
        poll?.cancel()
        poll = nil
    }

    @MainActor
    func send(_ text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        sending = true
        defer { sending = false }
        do {
            try await client.sendPrompt(key: thread.key, text: trimmed)
            // Don't optimistically append: the transcript is the source of
            // truth, and echoing here would double the message when it lands.
            await refresh()
        } catch {
            self.error = error.localizedDescription
        }
    }

    @MainActor
    func interrupt() async {
        try? await client.interrupt(key: thread.key)
        await refresh()
    }

}

struct ChatThreadView: View {
    @State var model: ChatThreadViewModel
    @State private var draft = ""
    @FocusState private var composerFocused: Bool

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                transcript
                composer
            }
        }
        .navigationTitle(model.thread.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    TerminalScreen(
                        model: SessionViewModel(
                            session: BridgeSession(
                                key: model.thread.key,
                                sessionId: "",
                                name: model.thread.name,
                                cwd: "",
                                repo: model.thread.repo,
                                branch: model.thread.branch,
                                model: "",
                                status: model.thread.status,
                                engine: model.thread.engine,
                                cols: 100,
                                rows: 30
                            ),
                            client: model.client))
                } label: {
                    Image(systemName: "terminal").foregroundStyle(GT.textMuted)
                }
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    if model.unsupported {
                        GTPanel {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("No chat for \(model.thread.engine) sessions yet")
                                    .font(GT.sans(13, .medium))
                                    .foregroundStyle(GT.text)
                                Text("Open the terminal to watch this one.")
                                    .font(GT.sans(12))
                                    .foregroundStyle(GT.textMuted)
                            }
                        }
                    }
                    ForEach(ChatDigest.build(model.messages)) { entry in
                        switch entry {
                        case .message(let message):
                            MessageRow(message: message).id(entry.id)
                        case .work(_, _, let steps, let failed):
                            WorkRow(steps: steps, failed: failed).id(entry.id)
                        }
                    }
                    if model.isWorking { WorkingIndicator() }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(14)
            }
            .onChange(of: model.messages.count) {
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) }
            }
        }
    }

    private var composer: some View {
        VStack(spacing: 0) {
            Divider().overlay(GT.border)
            HStack(spacing: 8) {
                TextField(
                    model.isWorking ? "Agent is working…" : "Message the agent",
                    text: $draft,
                    axis: .vertical
                )
                .lineLimit(1...5)
                .font(GT.sans(14))
                .foregroundStyle(GT.text)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.sentences)
                .focused($composerFocused)
                .accessibilityIdentifier("chat-composer")
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(Color.black.opacity(0.35))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(GT.border, lineWidth: 1))

                // While the agent is mid-turn, stopping it is the useful action —
                // and typing at it would land in whatever prompt it is showing.
                if model.isWorking {
                    Button {
                        Task { await model.interrupt() }
                    } label: {
                        Image(systemName: "stop.circle.fill")
                            .font(.system(size: 27))
                            .foregroundStyle(GT.red)
                    }
                    .accessibilityLabel("Interrupt the agent")
                } else {
                    Button {
                        let text = draft
                        draft = ""
                        Task { await model.send(text) }
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.system(size: 27))
                            .foregroundStyle(draft.isEmpty ? GT.textFaint : GT.accent)
                    }
                    .disabled(draft.isEmpty || model.sending)
                    .accessibilityLabel("Send")
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
        }
        .background(GT.panel)
    }
}

private struct MessageRow: View {
    let message: ChatMessage

    var body: some View {
        switch message {
        case .user(_, _, let text):
            HStack {
                Spacer(minLength: 40)
                Text(text)
                    .font(GT.sans(14))
                    .foregroundStyle(GT.text)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(GT.accent.opacity(0.22))
                    .clipShape(RoundedRectangle(cornerRadius: 13))
                    .overlay(
                        RoundedRectangle(cornerRadius: 13).stroke(GT.accent.opacity(0.35), lineWidth: 1)
                    )
                    .textSelection(.enabled)
            }
        case .assistant(_, _, let text):
            HStack {
                Text(text)
                    .font(GT.sans(14))
                    .foregroundStyle(GT.textSoft)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(GT.panel2)
                    .clipShape(RoundedRectangle(cornerRadius: 13))
                    .overlay(RoundedRectangle(cornerRadius: 13).stroke(GT.border, lineWidth: 1))
                    .textSelection(.enabled)
                Spacer(minLength: 40)
            }
        case .tool(_, _, let name, let summary, let status):
            HStack(spacing: 7) {
                Image(systemName: status.icon)
                    .font(.system(size: 10))
                    .foregroundStyle(status.tint)
                Text(name)
                    .font(GT.mono(11, .medium))
                    .foregroundStyle(GT.textMutedBright)
                Text(summary)
                    .font(GT.mono(11))
                    .foregroundStyle(GT.textFaint)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(GT.codeBg)
            .clipShape(RoundedRectangle(cornerRadius: 7))
        case .notice(_, _, let text):
            Text(text)
                .font(GT.sans(11))
                .foregroundStyle(GT.textFaint)
                .frame(maxWidth: .infinity, alignment: .center)
        }
    }
}

extension ChatMessage.ToolStatus {
    var icon: String {
        switch self {
        case .running: return "circle.dotted"
        case .ok: return "checkmark"
        case .error: return "xmark"
        }
    }
    var tint: Color {
        switch self {
        case .running: return GT.textFaint
        case .ok: return GT.green
        case .error: return GT.red
        }
    }
}

/// A run of tool calls, collapsed. Tap to see what it actually did.
private struct WorkRow: View {
    let steps: [ChatMessage]
    let failed: Int
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button { withAnimation(.easeOut(duration: 0.15)) { expanded.toggle() } } label: {
                HStack(spacing: 7) {
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .semibold))
                    Image(systemName: failed > 0 ? "exclamationmark.triangle" : "wrench.and.screwdriver")
                        .font(.system(size: 10))
                    Text(ChatDigest.summarize(steps))
                        .font(GT.sans(12))
                    if failed > 0 {
                        Text("· \(failed) failed")
                            .font(GT.sans(12))
                            .foregroundStyle(GT.red)
                    }
                    Spacer(minLength: 0)
                }
                .foregroundStyle(failed > 0 ? GT.yellow : GT.textFaint)
            }
            .buttonStyle(.plain)

            if expanded {
                ForEach(steps) { step in MessageRow(message: step) }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(GT.codeBg)
        .clipShape(RoundedRectangle(cornerRadius: 7))
    }
}

private struct WorkingIndicator: View {
    @State private var phase = 0.0
    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3, id: \.self) { i in
                Circle()
                    .fill(GT.accent2)
                    .frame(width: 5, height: 5)
                    .opacity(phase == Double(i) ? 1 : 0.3)
            }
            Text("working")
                .font(GT.sans(11))
                .foregroundStyle(GT.textFaint)
        }
        .padding(.leading, 4)
        .onAppear {
            withAnimation(.easeInOut(duration: 0.5).repeatForever()) { phase = 2 }
        }
    }
}
