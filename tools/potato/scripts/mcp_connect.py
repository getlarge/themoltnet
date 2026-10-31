"""Launch Potato's stdio bridge without putting the token in process arguments."""

import argparse
import os
from pathlib import Path

from potato.mcp_server.cli import main


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--token-file', required=True, type=Path)
    parser.add_argument('--root', required=True, type=Path,
                        help='Separate working directory for local authoring tools')
    args = parser.parse_args()
    if not args.url.startswith('https://'):
        parser.error('The remote endpoint must use HTTPS.')
    token_path = args.token_file.resolve()
    root = args.root.resolve()
    if token_path.is_relative_to(root):
        parser.error('Keep the token outside the authoring tools directory.')
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.environ['POTATO_AGENT_TOKEN'] = token_path.read_text().strip()
    raise SystemExit(main(['connect', '--url', args.url, '--root', str(root)]))
