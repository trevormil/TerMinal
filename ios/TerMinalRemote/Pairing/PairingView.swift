import SwiftUI

/// First run: scan (or paste) the code from TerMinal → Settings → Mobile.
struct PairingView: View {
    let onPaired: (PairingPayload) -> Void

    @State private var scanning = false
    @State private var error: String?

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "terminal.fill")
                .font(.system(size: 52))
                .foregroundStyle(.green)
            VStack(spacing: 8) {
                Text("Pair with your Mac")
                    .font(.system(size: 22, weight: .semibold))
                Text("On your Mac, open TerMinal → Settings → Mobile and turn on the bridge.")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 32)

            if let error {
                Text(error)
                    .font(.system(size: 13))
                    .foregroundStyle(.orange)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)
            }

            VStack(spacing: 10) {
                Button {
                    error = nil
                    scanning = true
                } label: {
                    Label("Scan QR code", systemImage: "qrcode.viewfinder")
                        .frame(maxWidth: .infinity, minHeight: 46)
                }
                .buttonStyle(.borderedProminent)
                .tint(.green)

                // No intermediate editor sheet: pasting IS the action. Use
                // "Copy pairing code" on the Mac, then tap this — one step, and
                // nobody ever wants to hand-edit the JSON.
                Button("Paste pairing code") {
                    error = nil
                    guard let clip = UIPasteboard.general.string, !clip.isEmpty else {
                        error = "Your clipboard is empty. Use “Copy pairing code” in "
                            + "TerMinal → Settings → Mobile."
                        return
                    }
                    accept(clip)
                }
                .font(.system(size: 14))
            }
            .padding(.horizontal, 32)
            Spacer()
        }
        .sheet(isPresented: $scanning) {
            NavigationStack {
                QRScanner(
                    onCode: { accept($0); scanning = false },
                    onUnavailable: { message in
                        error = message
                        scanning = false
                    }
                )
                .ignoresSafeArea()
                .navigationTitle("Scan")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("Cancel") { scanning = false }
                    }
                }
            }
        }
    }

    private func accept(_ raw: String) {
        do {
            onPaired(try PairingPayload.decode(raw))
        } catch {
            self.error = error.localizedDescription
        }
    }
}
