import SwiftUI

/// The morning briefing, mirroring `src/main/briefings.ts`. The phone is a
/// reader plus two verdict buttons; the Mac owns generation and the durable
/// record.
///
/// Every field but `id`/`kind`/`title` is optional because the briefing is
/// written by an agent from a markdown contract, not by a typed writer — a
/// missing `repo:` line must degrade to a row without a repo, never to a
/// decode failure that blanks the whole screen.
struct Briefing: Decodable, Equatable {
    let date: String
    let path: String?
    let generated: String?
    let status: String?
    let summary: String?
    let items: [BriefingItem]
}

struct BriefingItem: Decodable, Identifiable, Hashable {
    /// `<kind>-<ordinal>`, e.g. "pr-1". Stable across reparses of the same file.
    let id: String
    let kind: String
    let title: String
    let detail: String?
    let repo: String?
    let agent: String?
    let ledgerKey: String?
    let link: String?
    let verdict: String?
}

extension BriefingItem {
    var isReviewed: Bool { verdict != nil }

    /// An external URL, when the item points at one. `ticket:`/`run:` links are
    /// desktop tab deep-links with no phone equivalent, so they stay nil here
    /// rather than being handed to Safari as a bogus URL.
    var externalURL: URL? {
        guard let link, link.hasPrefix("https://") || link.hasPrefix("http://") else { return nil }
        return URL(string: link)
    }
}

/// Kind → (SF Symbol, colour). Mirrors the desktop's KIND_ICON/KIND_TONE so a
/// row reads the same on both surfaces.
enum BriefingKind {
    static func glyph(_ kind: String) -> (String, Color) {
        switch kind {
        case "pr": return ("arrow.triangle.pull", GT.accentLight)
        case "ticket": return ("ticket", GT.textSoft)
        case "idea": return ("lightbulb", GT.yellow)
        case "hitl": return ("exclamationmark.triangle", GT.red)
        case "run": return ("exclamationmark.triangle", GT.red)
        case "report": return ("doc.text", GT.textSoft)
        case "lesson": return ("sunrise", GT.green)
        default: return ("circle", GT.textMuted)
        }
    }

    /// Review order: blockers first, then PRs awaiting review, then proposals.
    /// The agent already ranks its output, but a phone screen shows ~4 rows, so
    /// re-sorting locally guarantees the important ones are the visible ones
    /// even if a briefing was written out of order.
    static func rank(_ kind: String) -> Int {
        switch kind {
        case "hitl", "run": return 0
        case "pr": return 1
        case "idea", "lesson": return 2
        case "ticket", "report": return 3
        default: return 4
        }
    }
}

/// Unreviewed first (that's the work), then by rank, then stable by id.
func sortedBriefingItems(_ items: [BriefingItem]) -> [BriefingItem] {
    items.sorted { a, b in
        if a.isReviewed != b.isReviewed { return !a.isReviewed }
        let ra = BriefingKind.rank(a.kind)
        let rb = BriefingKind.rank(b.kind)
        if ra != rb { return ra < rb }
        return a.id < b.id
    }
}
