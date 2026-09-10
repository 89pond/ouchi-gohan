import sys
import io
import re
from html.parser import HTMLParser
from pathlib import Path

# UTF-8 stdout
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

def check_html(file_path):
    print(f"[HTML Check] Inspecting {file_path}...")
    content = Path(file_path).read_text(encoding='utf-8')
    
    class StrictHTMLParser(HTMLParser):
        def __init__(self):
            super().__init__()
            self.tag_stack = []
            self.errors = []
            self.void_elements = {
                'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
                'link', 'meta', 'param', 'source', 'track', 'wbr'
            }

        def handle_starttag(self, tag, attrs):
            if tag.lower() not in self.void_elements:
                self.tag_stack.append((tag.lower(), self.getpos()))

        def handle_endtag(self, tag):
            tag = tag.lower()
            if tag in self.void_elements:
                return
            if not self.tag_stack:
                self.errors.append(f"Unexpected closing tag </{tag}> at line {self.getpos()[0]}")
                return
            last_tag, pos = self.tag_stack.pop()
            if last_tag != tag:
                self.errors.append(f"Mismatched tag: expected </{last_tag}> (opened line {pos[0]}), got </{tag}> at line {self.getpos()[0]}")

    parser = StrictHTMLParser()
    try:
        parser.feed(content)
        if parser.errors:
            for err in parser.errors:
                print(f"  [ERROR] HTML Error: {err}")
            return False
        print("  [OK] HTML tags are well-formed.")
        return True
    except Exception as e:
        print(f"  [ERROR] HTML Parse Exception: {e}")
        return False

def check_js(file_path):
    print(f"[JS Check] Inspecting {file_path}...")
    content = Path(file_path).read_text(encoding='utf-8')

    # トークン走査
    stack = []
    errors = []

    pos = 0
    line = 1
    col = 1
    n = len(content)

    # モードスタック: 'CODE' または ('TEMPLATE', depth)
    mode_stack = ['CODE']

    while pos < n:
        ch = content[pos]

        # 改行
        if ch == '\n':
            line += 1
            col = 1
            pos += 1
            continue

        mode = mode_stack[-1]

        # テンプレートリテラル文字列モード中
        if isinstance(mode, tuple) and mode[0] == 'TEMPLATE':
            if ch == '\\':
                pos += 2
                col += 2
                continue
            if ch == '`':
                # テンプレートリテラル終了
                mode_stack.pop()
                pos += 1
                col += 1
                continue
            if ch == '$' and pos + 1 < n and content[pos+1] == '{':
                # テンプレートリテラル内の埋め込み式開始
                mode_stack.append('CODE')
                stack.append(('${', line, col))
                pos += 2
                col += 2
                continue
            pos += 1
            col += 1
            continue

        # 通常のコードモード
        # 1. 一行コメント
        if ch == '/' and pos + 1 < n and content[pos+1] == '/':
            while pos < n and content[pos] != '\n':
                pos += 1
            continue

        # 2. ブロックコメント
        if ch == '/' and pos + 1 < n and content[pos+1] == '*':
            start_l, start_c = line, col
            pos += 2
            col += 2
            closed = False
            while pos + 1 < n:
                if content[pos] == '\n':
                    line += 1
                    col = 1
                    pos += 1
                    continue
                if content[pos] == '*' and content[pos+1] == '/':
                    pos += 2
                    col += 2
                    closed = True
                    break
                pos += 1
                col += 1
            if not closed:
                errors.append(f"Unclosed block comment starting at line {start_l}:{start_c}")
            continue

        # 3. 文字列リテラル (' or ")
        if ch in ("'", '"'):
            quote = ch
            start_l, start_c = line, col
            pos += 1
            col += 1
            closed = False
            while pos < n:
                c2 = content[pos]
                if c2 == '\n':
                    # JSではエスケープなし改行は不可
                    if pos == 0 or content[pos-1] != '\\':
                        errors.append(f"Unclosed string literal starting at line {start_l}:{start_c}")
                        break
                    line += 1
                    col = 1
                    pos += 1
                    continue
                if c2 == '\\':
                    pos += 2
                    col += 2
                    continue
                if c2 == quote:
                    pos += 1
                    col += 1
                    closed = True
                    break
                pos += 1
                col += 1
            continue

        # 4. テンプレートリテラル開始 (`)
        if ch == '`':
            mode_stack.append(('TEMPLATE', len(stack)))
            pos += 1
            col += 1
            continue

        # 5. 括弧の対応
        if ch in '({[':
            stack.append((ch, line, col))
        elif ch in ')}]':
            if not stack:
                errors.append(f"Unexpected closing '{ch}' at line {line}:{col}")
            else:
                open_ch, o_line, o_col = stack.pop()
                if open_ch == '${' and ch == '}':
                    # 埋め込み式の終了
                    if mode_stack and mode_stack[-1] == 'CODE':
                        mode_stack.pop()
                else:
                    expected = {'(': ')', '{': '}', '[': ']'}.get(open_ch)
                    if ch != expected:
                        errors.append(f"Mismatched bracket: opened '{open_ch}' at line {o_line}:{o_col}, closed with '{ch}' at line {line}:{col}")

        pos += 1
        col += 1

    if stack:
        for open_ch, line_num, col_num in stack[:10]:
            errors.append(f"Unclosed '{open_ch}' opened at line {line_num}:{col_num}")

    if errors:
        for err in errors[:10]:
            print(f"  [ERROR] JS Syntax Error: {err}")
        return False

    print(f"  [OK] JS Syntax brackets, quotes, and templates matched ({line} lines).")
    return True

def main():
    root = Path(__file__).parent
    ok = True
    html_file = root / "index.html"
    js_file = root / "js" / "app.bundle.js"

    if html_file.exists():
        if not check_html(html_file):
            ok = False
    if js_file.exists():
        if not check_js(js_file):
            ok = False

    if ok:
        print("\n[SUCCESS] All syntax checks passed successfully!")
        sys.exit(0)
    else:
        print("\n[FAILURE] Syntax errors detected! Please inspect and fix.")
        sys.exit(1)

if __name__ == "__main__":
    main()
