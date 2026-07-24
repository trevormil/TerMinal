import XCTest

@testable import TerMinalRemote

final class DiffModelsTests: XCTestCase {

    // ---- fixtures --------------------------------------------------------

    /// Two files: an edit (1 hunk) and a new file.
    private let multiFile = """
        diff --git a/src/main/agents.ts b/src/main/agents.ts
        index 1111111..2222222 100644
        --- a/src/main/agents.ts
        +++ b/src/main/agents.ts
        @@ -10,6 +10,7 @@ export function runSpec() {
           const a = 1
           const b = 2
        -  const c = 3
        +  const c = 4
        +  const d = 5
           return a
           // done
           // trailer
        diff --git a/docs/new.md b/docs/new.md
        new file mode 100644
        index 0000000..3333333
        --- /dev/null
        +++ b/docs/new.md
        @@ -0,0 +1,2 @@
        +# Title
        +Body
        """

    private let rename = """
        diff --git a/old/name.swift b/new/name.swift
        similarity index 95%
        rename from old/name.swift
        rename to new/name.swift
        index 4444444..5555555 100644
        --- a/old/name.swift
        +++ b/new/name.swift
        @@ -1,3 +1,3 @@
         import Foundation
        -let x = 1
        +let x = 2
        """

    private let binary = """
        diff --git a/assets/icon.png b/assets/icon.png
        index 6666666..7777777 100644
        Binary files a/assets/icon.png and b/assets/icon.png differ
        """

    private let deleted = """
        diff --git a/tmp/gone.txt b/tmp/gone.txt
        deleted file mode 100644
        index 8888888..0000000
        --- a/tmp/gone.txt
        +++ /dev/null
        @@ -1,2 +0,0 @@
        -first
        -second
        """

    private let noNewline = """
        diff --git a/a.txt b/a.txt
        index 1111111..2222222 100644
        --- a/a.txt
        +++ b/a.txt
        @@ -1 +1 @@
        -old
        \\ No newline at end of file
        +new
        \\ No newline at end of file
        """

    private let twoHunks = """
        diff --git a/f.txt b/f.txt
        index 1111111..2222222 100644
        --- a/f.txt
        +++ b/f.txt
        @@ -1,3 +1,3 @@
         one
        -two
        +TWO
         three
        @@ -20,3 +20,4 @@ context header
         twenty
        +twenty-and-a-half
         twenty-one
         twenty-two
        """

    // ---- multi-file ------------------------------------------------------

    func testMultiFileDiff() {
        let files = DiffParser.parse(multiFile)
        XCTAssertEqual(files.count, 2)

        let edit = files[0]
        XCTAssertEqual(edit.path, "src/main/agents.ts")
        XCTAssertEqual(edit.name, "agents.ts")
        XCTAssertEqual(edit.directory, "src/main")
        XCTAssertEqual(edit.additions, 2)
        XCTAssertEqual(edit.deletions, 1)
        XCTAssertFalse(edit.isNew)
        XCTAssertFalse(edit.isDeleted)
        XCTAssertFalse(edit.isRename)
        XCTAssertFalse(edit.isBinary)
        XCTAssertEqual(edit.hunks.count, 1)
        XCTAssertEqual(edit.hunks[0].header, "@@ -10,6 +10,7 @@ export function runSpec() {")
        XCTAssertEqual(edit.hunks[0].lines.count, 8)

        let added = files[1]
        XCTAssertEqual(added.path, "docs/new.md")
        XCTAssertTrue(added.isNew)
        XCTAssertEqual(added.additions, 2)
        XCTAssertEqual(added.deletions, 0)
    }

    // ---- rename ----------------------------------------------------------

    func testRename() {
        let files = DiffParser.parse(rename)
        XCTAssertEqual(files.count, 1)
        let f = files[0]
        XCTAssertTrue(f.isRename)
        XCTAssertEqual(f.fromPath, "old/name.swift")
        XCTAssertEqual(f.toPath, "new/name.swift")
        XCTAssertEqual(f.path, "new/name.swift")
        XCTAssertEqual(f.additions, 1)
        XCTAssertEqual(f.deletions, 1)
    }

    /// A pure rename (100% similarity) has no ---/+++ lines at all — paths
    /// must come from the rename from/to headers.
    func testPureRenameWithoutHunks() {
        let pure = """
            diff --git a/old/spot.swift b/new/spot.swift
            similarity index 100%
            rename from old/spot.swift
            rename to new/spot.swift
            """
        let files = DiffParser.parse(pure)
        XCTAssertEqual(files.count, 1)
        XCTAssertTrue(files[0].isRename)
        XCTAssertEqual(files[0].path, "new/spot.swift")
        XCTAssertTrue(files[0].hunks.isEmpty)
        XCTAssertEqual(files[0].additions, 0)
        XCTAssertEqual(files[0].deletions, 0)
    }

    // ---- binary ----------------------------------------------------------

    func testBinaryFile() {
        let files = DiffParser.parse(binary)
        XCTAssertEqual(files.count, 1)
        let f = files[0]
        XCTAssertTrue(f.isBinary)
        // Binary entries carry no ---/+++ lines; the diff --git header is the
        // only path source.
        XCTAssertEqual(f.path, "assets/icon.png")
        XCTAssertTrue(f.hunks.isEmpty)
        XCTAssertEqual(f.additions, 0)
        XCTAssertEqual(f.deletions, 0)
    }

    // ---- new / deleted ---------------------------------------------------

    func testDeletedFile() {
        let files = DiffParser.parse(deleted)
        XCTAssertEqual(files.count, 1)
        let f = files[0]
        XCTAssertTrue(f.isDeleted)
        XCTAssertFalse(f.isRename)
        // A deleted file's display path is the OLD path (+++ is /dev/null).
        XCTAssertEqual(f.path, "tmp/gone.txt")
        XCTAssertEqual(f.additions, 0)
        XCTAssertEqual(f.deletions, 2)
        XCTAssertEqual(f.hunks[0].lines.map(\.kind), [.del, .del])
    }

    // ---- line numbers ----------------------------------------------------

    func testLineNumbersAcrossChanges() {
        let files = DiffParser.parse(multiFile)
        let lines = files[0].hunks[0].lines
        // @@ -10,6 +10,7 @@ — context, context, del, add, add, context…
        XCTAssertEqual(lines[0].kind, .context)
        XCTAssertEqual(lines[0].oldLine, 10)
        XCTAssertEqual(lines[0].newLine, 10)
        XCTAssertEqual(lines[1].oldLine, 11)
        XCTAssertEqual(lines[1].newLine, 11)

        let del = lines[2]
        XCTAssertEqual(del.kind, .del)
        XCTAssertEqual(del.oldLine, 12)
        XCTAssertNil(del.newLine)
        XCTAssertEqual(del.text, "  const c = 3")

        let add1 = lines[3]
        XCTAssertEqual(add1.kind, .add)
        XCTAssertNil(add1.oldLine)
        XCTAssertEqual(add1.newLine, 12)
        let add2 = lines[4]
        XCTAssertEqual(add2.newLine, 13)

        // Context after the change resumes both counters, offset by the delta.
        let after = lines[5]
        XCTAssertEqual(after.kind, .context)
        XCTAssertEqual(after.oldLine, 13)
        XCTAssertEqual(after.newLine, 14)
    }

    func testLineNumbersAcrossHunks() {
        let files = DiffParser.parse(twoHunks)
        XCTAssertEqual(files.count, 1)
        let hunks = files[0].hunks
        XCTAssertEqual(hunks.count, 2)

        // Second hunk restarts numbering at its own header offsets.
        let h2 = hunks[1]
        XCTAssertEqual(h2.header, "@@ -20,3 +20,4 @@ context header")
        XCTAssertEqual(h2.lines[0].oldLine, 20)
        XCTAssertEqual(h2.lines[0].newLine, 20)
        let add = h2.lines[1]
        XCTAssertEqual(add.kind, .add)
        XCTAssertEqual(add.newLine, 21)
        XCTAssertEqual(h2.lines[2].oldLine, 21)
        XCTAssertEqual(h2.lines[2].newLine, 22)
        XCTAssertEqual(h2.lines[3].oldLine, 22)
        XCTAssertEqual(h2.lines[3].newLine, 23)

        XCTAssertEqual(files[0].additions, 2)
        XCTAssertEqual(files[0].deletions, 1)
    }

    // ---- no-newline marker ----------------------------------------------

    func testNoNewlineMarkersAreSkipped() {
        let files = DiffParser.parse(noNewline)
        XCTAssertEqual(files.count, 1)
        let lines = files[0].hunks[0].lines
        XCTAssertEqual(lines.count, 2)
        XCTAssertEqual(lines.map(\.kind), [.del, .add])
        XCTAssertEqual(lines[0].text, "old")
        XCTAssertEqual(lines[1].text, "new")
        XCTAssertEqual(lines[1].newLine, 1)
    }

    // ---- empty / degenerate ---------------------------------------------

    func testEmptyInput() {
        XCTAssertEqual(DiffParser.parse(""), [])
    }

    func testWhitespaceOnlyInput() {
        XCTAssertEqual(DiffParser.parse("\n\n"), [])
    }

    func testModeChangeOnly() {
        let mode = """
            diff --git a/bin/tool.sh b/bin/tool.sh
            old mode 100644
            new mode 100755
            """
        let files = DiffParser.parse(mode)
        XCTAssertEqual(files.count, 1)
        XCTAssertEqual(files[0].path, "bin/tool.sh")
        XCTAssertTrue(files[0].hunks.isEmpty)
    }

    // ---- totals ----------------------------------------------------------

    func testParsedDiffTotals() {
        let parsed = ParsedDiff(files: DiffParser.parse(multiFile), truncated: false)
        XCTAssertEqual(parsed.additions, 4)
        XCTAssertEqual(parsed.deletions, 1)
    }
}
