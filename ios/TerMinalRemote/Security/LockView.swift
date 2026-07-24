import SwiftUI

/// Full-screen gate shown over the app while AppLock.locked.
///
/// When biometrics are opted in, the lock leads with a dedicated Face ID
/// screen (auto-prompts on foreground) and offers "Use passcode" as the
/// fallback. Without biometrics it goes straight to the passcode pad.
struct LockView: View {
    @State private var lock = AppLock.shared
    @State private var entered = ""
    @State private var shake = false
    @State private var lockoutLeft = 0
    /// Start on the Face ID screen only when biometrics is actually set.
    @State private var showPad: Bool = !AppLock.shared.biometricsOptIn
    @Environment(\.scenePhase) private var scenePhase

    private let columns = [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())]
    private var length: Int { max(4, lock.passcodeLength) }
    private let ticker = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            GT.bg.ignoresSafeArea()
            if showPad {
                passcodePad
            } else {
                biometricScreen
            }
        }
        // Auto-prompt Face ID every time the app returns to the foreground while
        // locked (unlockWithBiometrics no-ops unless the app is truly active, so
        // it never fires behind the iOS lock screen). Only while on the Face ID
        // screen — once the user chooses the passcode we don't re-pop the sheet.
        .task { if !showPad { await lock.unlockWithBiometrics() } }
        .onAppear { lockoutLeft = lock.lockoutRemaining() }
        .onReceive(ticker) { _ in lockoutLeft = lock.lockoutRemaining() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active, !showPad { Task { await lock.unlockWithBiometrics() } }
        }
    }

    // ---- Face ID first screen -------------------------------------------
    private var biometricScreen: some View {
        VStack(spacing: 22) {
            Spacer()
            Image("Logo")
                .resizable().scaledToFit()
                .frame(width: 60, height: 60)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            Text("TerMinal is locked")
                .font(GT.sans(17, .semibold)).foregroundStyle(GT.text)
            Button {
                Task { await lock.unlockWithBiometrics() }
            } label: {
                VStack(spacing: 10) {
                    Image(systemName: "faceid")
                        .font(.system(size: 46, weight: .regular))
                        .foregroundStyle(GT.accentLight)
                    Text("Unlock with Face ID")
                        .font(GT.sans(13, .medium)).foregroundStyle(GT.textSoft)
                }
                .frame(width: 180, height: 140)
                .background(GT.panel2)
                .clipShape(RoundedRectangle(cornerRadius: 18))
            }
            .buttonStyle(.plain)
            Spacer()
            Button("Use passcode") { showPad = true }
                .font(GT.sans(14, .medium)).foregroundStyle(GT.accentLight)
            Spacer().frame(height: 24)
        }
    }

    // ---- passcode pad ----------------------------------------------------
    private var passcodePad: some View {
        VStack(spacing: 26) {
            Spacer()
            Image("Logo")
                .resizable().scaledToFit()
                .frame(width: 56, height: 56)
                .clipShape(RoundedRectangle(cornerRadius: 13))
            Text(lockoutLeft > 0 ? "Too many attempts" : "Enter passcode")
                .font(GT.sans(16, .semibold))
                .foregroundStyle(lockoutLeft > 0 ? GT.red : GT.text)

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

            if lockoutLeft > 0 {
                Text("Try again in \(lockoutLeft)s")
                    .font(GT.sans(13)).foregroundStyle(GT.textMuted)
            }

            LazyVGrid(columns: columns, spacing: 16) {
                ForEach(1...9, id: \.self) { n in
                    digit("\(n)")
                }
                // Bottom row: Face ID (back to biometric screen) · 0 · delete
                Group {
                    if lock.biometricsOptIn {
                        padButton(systemImage: "faceid") { showPad = false }
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

    private func digit(_ d: String) -> some View {
        padButton(label: d) {
            // No guesses while locked out.
            guard lockoutLeft == 0, entered.count < length else { return }
            entered.append(d)
            if entered.count == length {
                if !lock.unlock(with: entered) {
                    entered = ""
                    shake = true
                    lockoutLeft = lock.lockoutRemaining()
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
