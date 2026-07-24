import SwiftUI

/// Full-screen passcode gate shown over the app while AppLock.locked.
/// Face ID (when opted in) fires on appear; the pad is always available.
struct LockView: View {
    @State private var lock = AppLock.shared
    @State private var entered = ""
    @State private var shake = false

    private let columns = [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())]
    private var length: Int { max(4, lock.passcodeLength) }

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            VStack(spacing: 26) {
                Spacer()
                Image("Logo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 56, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: 13))
                Text("Enter passcode")
                    .font(GT.sans(16, .semibold))
                    .foregroundStyle(GT.text)

                HStack(spacing: 14) {
                    ForEach(0..<length, id: \.self) { i in
                        Circle()
                            .fill(i < entered.count ? GT.accent : GT.border)
                            .frame(width: 12, height: 12)
                    }
                }
                .offset(x: shake ? -8 : 0)
                .animation(
                    shake ? .linear(duration: 0.06).repeatCount(5, autoreverses: true) : .default,
                    value: shake)

                LazyVGrid(columns: columns, spacing: 16) {
                    ForEach(1...9, id: \.self) { n in
                        digit("\(n)")
                    }
                    // Bottom row: Face ID · 0 · delete
                    Group {
                        if lock.biometricsOptIn {
                            padButton(systemImage: "faceid") {
                                Task { await lock.unlockWithBiometrics() }
                            }
                        } else {
                            Color.clear.frame(height: 64)
                        }
                        digit("0")
                        padButton(systemImage: "delete.left") {
                            if !entered.isEmpty { entered.removeLast() }
                        }
                    }
                }
                .padding(.horizontal, 44)
                Spacer()
                Spacer()
            }
        }
        .task { await lock.unlockWithBiometrics() }
    }

    private func digit(_ d: String) -> some View {
        padButton(label: d) {
            guard entered.count < length else { return }
            entered.append(d)
            if entered.count == length {
                if !lock.unlock(with: entered) {
                    entered = ""
                    shake = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { shake = false }
                }
            }
        }
    }

    private func padButton(
        label: String? = nil, systemImage: String? = nil, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            ZStack {
                Circle().fill(GT.panel2).frame(width: 64, height: 64)
                if let label {
                    Text(label).font(GT.sans(24, .medium)).foregroundStyle(GT.text)
                } else if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 20))
                        .foregroundStyle(GT.textSoft)
                }
            }
        }
        .buttonStyle(.plain)
    }
}

/// Settings flow for creating / changing a passcode: enter twice to confirm.
struct SetPasscodeSheet: View {
    let onDone: (String?) -> Void
    @State private var length = 6
    @State private var first = ""
    @State private var entry = ""
    @State private var stage = Stage.enter
    @Environment(\.dismiss) private var dismiss

    enum Stage {
        case enter, confirm, mismatch
    }

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            VStack(spacing: 20) {
                Text(stage == .enter ? "Choose a \(length)-digit passcode" : "Re-enter to confirm")
                    .font(GT.sans(15, .semibold)).foregroundStyle(GT.text)
                if stage == .enter {
                    Picker("Length", selection: $length) {
                        Text("4 digits").tag(4)
                        Text("6 digits").tag(6)
                    }
                    .pickerStyle(.segmented)
                    .frame(width: 220)
                    .onChange(of: length) { _, _ in entry = "" }
                }
                if stage == .mismatch {
                    Text("Didn't match — start over.").font(GT.sans(12)).foregroundStyle(GT.red)
                }
                SecureField("passcode", text: $entry)
                    .keyboardType(.numberPad)
                    .textContentType(.oneTimeCode)
                    .multilineTextAlignment(.center)
                    .font(GT.mono(22))
                    .foregroundStyle(GT.text)
                    .padding(12)
                    .background(GT.panel2)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .frame(maxWidth: 220)
                    .onChange(of: entry) { _, v in
                        let digits = String(v.filter(\.isNumber).prefix(length))
                        if digits != v { entry = digits }
                        guard digits.count == length else { return }
                        if stage == .enter || stage == .mismatch {
                            first = digits
                            entry = ""
                            stage = .confirm
                        } else if digits == first {
                            onDone(digits)
                            dismiss()
                        } else {
                            first = ""
                            entry = ""
                            stage = .mismatch
                        }
                    }
                Button("Cancel") {
                    onDone(nil)
                    dismiss()
                }
                .font(GT.sans(13)).foregroundStyle(GT.textMuted)
            }
            .padding(24)
        }
        .preferredColorScheme(.dark)
    }
}
