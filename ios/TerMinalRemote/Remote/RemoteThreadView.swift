import SwiftUI

@Observable
final class RemoteThreadViewModel {
    private(set) var messages: [RemoteMessage] = []
    private(set) var status: String
    private(set) var question: String?
    private(set) var error: String?
    private(set) var loading = true
    private(set) var sending = false

    let session: RemoteSession
    let client: BridgeClient
    private var poll: Task<Void, Never>?

    var isAwaiting: Bool { status == "awaiting" }
    var hasEnded: Bool { status == "ended" }

    init(session: RemoteSession, client: BridgeClient) {
        self.session = session
        self.client = client
        self.status = session.status
        self.question = session.question
    }

    @MainActor
    func refresh() async {
        defer { loading = false }
        do {
            // Ask only for what we don't have — this polls every couple of
            // seconds and a long session's log keeps growing.
            let page = try await client.messages(id: session.id, after: messages.count)
            if !page.messages.isEmpty { messages.append(contentsOf: page.messages) }
            status = page.status
            question = page.question
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
            try await client.reply(id: session.id, text: trimmed)
            // Don't echo locally: the Mac's log is the source of truth, and the
            // next poll picks the message up.
            await refresh()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct RemoteThreadView: View {
    @State var model: RemoteThreadViewModel
    @State private var draft = ""
    @FocusState private var composerFocused: Bool

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            VStack(spacing: 0) {
                transcript
                if model.hasEnded { endedBanner } else { composer }
            }
        }
        .navigationTitle(model.session.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(GT.panel, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 10) {
                    ForEach(model.messages) { message in
                        MessageBubble(message: message).id(message.id)
                    }
                    if model.isAwaiting, let question = model.question {
                        AwaitingBanner(question: question)
                    }
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(14)
            }
            .onChange(of: model.messages.count) {
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) }
            }
        }
    }

    private var endedBanner: some View {
        HStack(spacing: 6) {
            Image(systemName: "checkmark.circle").font(.system(size: 11))
            Text("Session finished").font(GT.sans(12))
        }
        .foregroundStyle(GT.textFaint)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 14)
        .background(GT.panel)
    }

    private var composer: some View {
        VStack(spacing: 0) {
            Divider().overlay(GT.border)
            HStack(spacing: 8) {
                TextField(
                    model.isAwaiting ? "Answer the agent" : "Send a message",
                    text: $draft,
                    axis: .vertical
                )
                .lineLimit(1...5)
                .font(GT.sans(14))
                .foregroundStyle(GT.text)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.sentences)
                .focused($composerFocused)
                .accessibilityIdentifier("remote-composer")
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(Color.black.opacity(0.35))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(model.isAwaiting ? GT.accent2.opacity(0.5) : GT.border, lineWidth: 1)
                )

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
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
        }
        .background(GT.panel)
    }
}

/// The agent is blocked in `ask` — say so, so a reply feels answered rather
/// than shouted into a log.
private struct AwaitingBanner: View {
    let question: String

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: "questionmark.circle.fill")
                .font(.system(size: 12))
                .foregroundStyle(GT.accent2)
            Text("Waiting on your answer")
                .font(GT.sans(12, .medium))
                .foregroundStyle(GT.accent2)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 11)
        .padding(.vertical, 8)
        .background(GT.accent2.opacity(0.1))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }
}

private struct MessageBubble: View {
    let message: RemoteMessage

    var body: some View {
        HStack {
            if !message.isAgent { Spacer(minLength: 40) }
            Text(message.text)
                .font(GT.sans(14))
                .foregroundStyle(message.isAgent ? GT.textSoft : GT.text)
                .padding(.horizontal, 12)
                .padding(.vertical, 9)
                .background(message.isAgent ? GT.panel2 : GT.accent.opacity(0.22))
                .clipShape(RoundedRectangle(cornerRadius: 13))
                .overlay(
                    RoundedRectangle(cornerRadius: 13)
                        .stroke(message.isAgent ? GT.border : GT.accent.opacity(0.35), lineWidth: 1)
                )
                .textSelection(.enabled)
            if message.isAgent { Spacer(minLength: 40) }
        }
    }
}
