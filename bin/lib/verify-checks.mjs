/**
 * verify-checks.mjs — pure diff analysis for scripts/verify.mjs.
 *
 * The one check the automated gates cannot otherwise make: did the change get to
 * green by weakening the tests? House rule forbids it; nothing enforced it. These
 * functions read a unified diff and flag the shapes that weakening takes. Kept
 * pure so they can be unit-tested against sample diffs.
 */

// A path that holds tests rather than the code under test.
const TEST_PATH_RE = new RegExp(
  [
    '(^|/)(tests?|__tests__|spec)(/|$)',
    '\\.(test|spec)\\.[cm]?[jt]sx?$',
    '(^|/)test_[^/]+\\.py$',
    '(^|/)[^/]+_test\\.(py|go|rb)$',
    '(^|/)conftest\\.py$',
  ].join('|'),
  'i',
);

export function isTestPath(p) {
  return TEST_PATH_RE.test(String(p).replace(/\\/g, '/'));
}

/**
 * Minimal unified-diff parser. Returns one entry per file with its added and
 * removed content lines (hunk headers, context, and metadata dropped).
 */
export function parseUnifiedDiff(text) {
  const files = [];
  let cur = null;
  for (const raw of String(text).split('\n')) {
    if (raw.startsWith('diff --git')) {
      const m = raw.match(/ b\/(.+)$/);
      cur = { file: m ? m[1] : null, added: [], removed: [], deletedFile: false, newFile: false };
      files.push(cur);
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith('--- ')) {
      if (raw.trim() === '--- /dev/null') cur.newFile = true;
    } else if (raw.startsWith('+++ ')) {
      if (raw.trim() === '+++ /dev/null') cur.deletedFile = true;
      else {
        const m = raw.match(/^\+\+\+ b\/(.+)$/);
        if (m) cur.file = m[1];
      }
    } else if (raw.startsWith('@@') || raw.startsWith('\\ ')) {
      // hunk header / "No newline at end of file" — ignore
    } else if (raw.startsWith('+')) {
      cur.added.push(raw.slice(1));
    } else if (raw.startsWith('-')) {
      cur.removed.push(raw.slice(1));
    }
  }
  return files;
}

const DEF_RE = /(^|\s)(it|test|describe|context)\s*\(|^\s*(async\s+)?def\s+test_\w+\s*\(|@Test\b/;
const SKIP_RE = /\b(it|test|describe)\.(skip|only)\b|\bxit\s*\(|\bxdescribe\s*\(|@pytest\.mark\.skip|@unittest\.skip\b|\bt\.Skip\(|@Ignore\b/;
const ASSERT_RE = /\b(assert|expect|assertEquals?|assertTrue|assertFalse|assertRaises|assertThat)\b|\.(should|to)\b|\brequire\.(Equal|NoError|True|Nil)\b/;

/**
 * Flag test-file edits that look like the change was made to pass rather than to
 * work. Advisory by default — the caller decides whether a flag fails the gate.
 */
export function scanTestTamper(diffText) {
  const flags = [];
  for (const f of parseUnifiedDiff(diffText)) {
    if (!f.file || !isTestPath(f.file)) continue;

    if (f.deletedFile) {
      flags.push({ file: f.file, kind: 'test-file-deleted' });
      continue;
    }

    const defsOut = f.removed.filter((l) => DEF_RE.test(l)).length;
    const defsIn = f.added.filter((l) => DEF_RE.test(l)).length;
    if (defsOut > defsIn) {
      flags.push({
        file: f.file, kind: 'tests-removed',
        detail: `${defsOut - defsIn} more test declaration(s) removed than added`,
      });
    }

    const skip = f.added.find((l) => SKIP_RE.test(l));
    if (skip) flags.push({ file: f.file, kind: 'skip-or-only-added', detail: skip.trim().slice(0, 120) });

    const assertOut = f.removed.filter((l) => ASSERT_RE.test(l)).length;
    const assertIn = f.added.filter((l) => ASSERT_RE.test(l)).length;
    if (assertOut - assertIn >= 2) {
      flags.push({
        file: f.file, kind: 'assertions-reduced',
        detail: `${assertOut - assertIn} net assertion line(s) removed`,
      });
    }
  }
  return { ok: flags.length === 0, flags };
}
