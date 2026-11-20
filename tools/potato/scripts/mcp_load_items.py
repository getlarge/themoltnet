"""Add an immutable item batch through Potato's actual stdio MCP bridge.

Existing IDs must match every supplied field. Never replaces or deletes items,
never submits human annotations. Scan private inputs before invoking this tool.
"""
import argparse
import asyncio
import json
from pathlib import Path
import sys

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


async def load(args):
    items = [json.loads(line) for line in args.items.read_text().splitlines() if line.strip()]
    if not items or any(not isinstance(i, dict) or not isinstance(i.get('id'), str) or not i['id'] for i in items):
        raise ValueError('Every item needs a nonempty string id')
    if len({i['id'] for i in items}) != len(items):
        raise ValueError('Duplicate batch IDs')
    server = StdioServerParameters(command=sys.executable, args=[
        str(Path(__file__).with_name('mcp_connect.py')), '--url', args.url,
        '--token-file', str(args.token_file), '--root', str(args.root),
    ])
    async with stdio_client(server) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            async def call(name, arguments):
                result = await session.call_tool('live_' + name, arguments)
                if result.isError:
                    raise RuntimeError(f'Potato refused {name}; no annotation writes attempted')
                texts = [block.text for block in result.content if block.type == 'text']
                return json.loads('\n'.join(texts))
            existing = set()
            offset = 0
            while True:
                page = await call('list_items', {'limit': 100, 'offset': offset})
                existing.update(i['instance_id'] for i in page['items'])
                offset += len(page['items'])
                if offset >= page['total']:
                    break
                if not page['items']:
                    raise RuntimeError('Incomplete item inventory')
            # Validate all conflicts before the first mutation.
            for item in items:
                if item['id'] in existing:
                    current = await call('get_item', {'instance_id': item['id']})
                    if any(current['data'].get(k) != v for k, v in item.items()):
                        raise ValueError('Existing item differs; use a new version/task, never overwrite reviewed inputs')
            missing = [i for i in items if i['id'] not in existing]
            for offset in range(0, len(missing), 25):
                batch = missing[offset:offset + 25]
                result = await call('add_items', {'items': batch})
                if set(result['added']) != {i['id'] for i in batch}:
                    raise RuntimeError('Incomplete MCP addition; retry the same immutable batch')
            status = await call('get_status', {})
            progress = await call('get_progress', {})
            print(json.dumps({'added': len(missing), 'unchanged': len(items) - len(missing), 'status': status, 'progress': progress}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True)
    parser.add_argument('--token-file', required=True, type=Path)
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--items', required=True, type=Path)
    asyncio.run(load(parser.parse_args()))
