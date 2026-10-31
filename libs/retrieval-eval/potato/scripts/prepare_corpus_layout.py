"""Generate a compact corpus form while keeping Potato's native save controls."""
import argparse
import copy
from pathlib import Path

import yaml
from potato.server_utils.front_end import generate_schematic

STYLE = '''<style>
body { padding-bottom: 6rem; }
.potato-nav {
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;
  width: auto; max-width: none; margin: 0;
  padding: 0.75rem max(1rem, env(safe-area-inset-right))
    max(0.75rem, env(safe-area-inset-bottom));
  background: var(--light-bg, #fff); border-top: 1px solid #8885;
  box-shadow: 0 -2px 10px #0001;
}
.corpus-editor { margin: 1rem 0; }
.corpus-editor summary { cursor: pointer; padding: 0.75rem 0; font-weight: 600; }
.corpus-editor summary:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
.corpus-editor .text-edit-source-block { display: none; }
.corpus-editor .text-edit-textarea {
  height: 12rem; min-height: 6rem; max-height: 60vh;
  resize: vertical; overflow: auto;
}
</style>'''


def build_layout(config):
    parts = [STYLE]
    for scheme in config['annotation_schemes']:
        markup, _ = generate_schematic(copy.deepcopy(scheme))
        if scheme['name'] == 'proposed_body':
            parts.append('''<details class="corpus-editor" id="corpus-editor"><summary>View or propose a body edit (optional)</summary>''')
            parts.append(markup)
            parts.append('</details>')
        else:
            parts.append(markup)
    return '\n'.join(parts) + '\n'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    args.output.write_text(build_layout(yaml.safe_load(args.config.read_text())))
