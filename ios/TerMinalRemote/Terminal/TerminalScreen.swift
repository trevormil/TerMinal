import SwiftUI

/// One attached session: the mirrored screen, a prompt field, and the key bar.
struct TerminalScreen: View {
    @State var model: SessionViewModel
    @State private var draft = ""
    @FocusState private var promptFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                Color.black
                TerminalMirror(model: model)
                overlay
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            KeyBar(send: model.send)
            prompt
        }
        .background(.black)
        .navigationTitle(model.session.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.black, for: .navigationBar)
        .toolbarColorScheme(.dark, for: .navigationBar)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }

    @ViewBuilder
    private var overlay: some View {
        switch model.state {
        case .connecting:
            ProgressView().tint(.white)
        case .ended(let code):
            banner("Session ended (exit \(code))", tint: .orange)
        case .failed(let message):
            banner(message, tint: .red)
        case .live:
            EmptyView()
        }
    }

    private func banner(_ text: String, tint: Color) -> some View {
        VStack {
            Spacer()
            Text(text)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(tint)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(.black.opacity(0.85))
                .clipShape(Capsule())
                .padding(.bottom, 12)
        }
    }

    /// A plain send field. Typing directly into the mirrored terminal also
    /// works, but on a phone a real text field gives autocorrect-free dictation
    /// and a send button, which is how you actually prompt an agent one-handed.
    private var prompt: some View {
        HStack(spacing: 8) {
            TextField("Message the agent…", text: $draft, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(1...4)
                .font(.system(size: 14, design: .monospaced))
                .foregroundStyle(.white)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .focused($promptFocused)
                .accessibilityIdentifier("session-prompt")
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(Color.white.opacity(0.07))
                .clipShape(RoundedRectangle(cornerRadius: 9))

            Button {
                guard !draft.isEmpty else { return }
                model.send(text: draft + "\r")
                draft = ""
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 26))
                    .foregroundStyle(draft.isEmpty ? .gray : .green)
            }
            .disabled(draft.isEmpty)
            .accessibilityLabel("Send to session")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(.black)
    }
}
