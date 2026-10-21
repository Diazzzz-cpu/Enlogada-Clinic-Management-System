"""
Find prose that a mechanical rename walked through.

The earlier version of this check only looked at '...' and "..." literals. The damage the
collaborator found -- "Release CBC entry.findings for Juan Dela Cruz?" -- lived in a TEMPLATE
literal, so the scan reported clean while a technician was reading it on screen.

This version reads all three quote styles, and for template literals strips the ${...}
interpolations first: what is left is the part a human actually reads. `${refund.target.amount}`
is code and fine; "Refund refund.target.amount" would not be.
"""
import io
import re
import glob
import sys

BACKTICK = chr(96)

# Every name a hook object is bound to in a component. THIS LIST IS THE SCANNER'S EYESIGHT:
# a prefix missing from it is damage the scan cannot see, which is exactly how
# "Effective access.permissions" survived a run that reported clean. Add a name here whenever a
# new hook is introduced, in the same commit.
HOOKS = [
    'profiles', 'results', 'bookings', 'payments', 'worklist', 'entry', 'criticals',
    'checkout', 'queue', 'history', 'lookup', 'checkIn', 'disposition', 'hmo', 'reference',
    'testAssignment', 'patientHistory', 'refund', 'receipt', 'operations', 'summary',
    'access', 'elevated', 'catalogue', 'hmoAdmin', 'arrivals', 'hours', 'reads', 'grid',
    'cardPhoto', 'doctorRequest', 'invitations', 'visits',
]
bad = re.compile(r'\b(' + '|'.join(HOOKS) + r')\.[a-zA-Z]')


def strip_interpolations(s):
    """Remove ${ ... } (brace-aware), leaving only the literal text."""
    out, i = [], 0
    while i < len(s):
        if s[i:i + 2] == '${':
            depth, i = 1, i + 2
            while i < len(s) and depth:
                if s[i] == '{':
                    depth += 1
                elif s[i] == '}':
                    depth -= 1
                i += 1
            continue
        out.append(s[i])
        i += 1
    return ''.join(out)


def strip_braced(s):
    """Remove brace-matched {...} regions -- JSX expression containers."""
    out, i, n = [], 0, len(s)
    while i < n:
        if s[i] == '{':
            depth, i = 1, i + 1
            while i < n and depth:
                if s[i] == '{':
                    depth += 1
                elif s[i] == '}':
                    depth -= 1
                i += 1
            continue
        out.append(s[i])
        i += 1
    return ''.join(out)


def strip_comments(src):
    src = re.sub(r'/\*[\s\S]*?\*/', '', src)
    return re.sub(r'^\s*//.*$', '', src, flags=re.M)


def jsx_text(src):
    """
    The words between tags -- the third place prose lives, and the one that let
    "SuperAdmin - 30 access.permissions" reach the screen while this scanner reported clean.

    Not a parser. Take everything after a '>' up to the next '<', drop the {...} expression
    containers inside it, and what is left is what a reader sees.
    """
    for chunk in re.findall(r'>([^<>]+)<', src):
        # Drop JSX expression containers as well as template interpolations. {checkout.error}
        # is code that happens to sit between tags; only what survives is read by a human.
        text = strip_interpolations(strip_braced(chunk)).strip()
        if not text:
            continue
        # `>` also ends an arrow and a comparison, so this regex catches plain JS between a `=>`
        # and the next `<`. Prose does not carry these; code almost always does.
        if any(ch in text for ch in ';=()'):
            continue
        yield text


def scan(root):
    files = sorted(glob.glob(root + '/**/*.jsx', recursive=True) +
                   glob.glob(root + '/**/*.js', recursive=True))
    findings = []
    tmpl = re.compile(BACKTICK + r'([^' + BACKTICK + r']*)' + BACKTICK, re.S)
    quoted = re.compile(r'"([^"\n]*)"' + r"|'([^'\n]*)'")

    for f in files:
        raw = io.open(f, encoding='utf-8').read()
        src = strip_comments(raw)
        for m in tmpl.finditer(src):
            prose = strip_interpolations(m.group(1))
            if bad.search(prose):
                findings.append((f, 'template', prose.strip()[:110]))
        # Template literals are checked above and must not be re-read as quoted strings: a
        # template commonly contains real `"` characters around an interpolation, e.g.
        #   `Deactivate "${hmoAdmin.confirmTarget.name}"?`
        # and the quoted regex reads that pair as a double-quoted string full of code.
        without_templates = tmpl.sub('', src)
        for m in quoted.finditer(without_templates):
            s = m.group(1) if m.group(1) is not None else m.group(2)
            if s and bad.search(s) and not s.startswith(('.', '/', '@')):
                findings.append((f, 'quoted', s[:110]))
        for text in jsx_text(src):
            if bad.search(text):
                findings.append((f, 'jsx-text', text[:110]))
        # JSX comments survive strip_comments (they are {/* ... */}, not // or /* ... */) and
        # are read by whoever edits the file next, so they count as prose too.
        for m in re.finditer(r'\{/\*([\s\S]*?)\*/\}', raw):
            # A backtick-quoted `hook.property` in prose is a DELIBERATE code reference -- the
            # convention this codebase uses to name a thing it is talking about. Damage never
            # arrives quoted, because a rename does not add backticks.
            text = re.sub(BACKTICK + r'[^' + BACKTICK + r']*' + BACKTICK, '', m.group(1))
            if bad.search(text):
                findings.append((f, 'jsx-comment', ' '.join(text.split())[:110]))
    return findings, len(files)


if __name__ == '__main__':
    # The clinic's own copy contains a peso sign; Windows' default console codec cannot encode
    # it and the scanner would die reporting a finding rather than reporting it.
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except AttributeError:
        pass

    root = sys.argv[1] if len(sys.argv) > 1 else 'frontend/src'
    findings, n = scan(root)
    for f, kind, text in findings:
        print('  {:9} {}\n            ...{}...'.format(kind, f, text))
    print('\nfiles scanned: {}'.format(n))
    print('prose damage found: {}'.format(len(findings)))
    sys.exit(1 if findings else 0)
