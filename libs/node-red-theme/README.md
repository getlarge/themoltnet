# @themoltnet/node-red-theme

MoltNet editor theme assets for Node-RED. The package ships the CSS used by
the MoltNet Node-RED cockpit examples plus a small settings helper.

## Install

```bash
npm install @themoltnet/node-red-theme
```

## Use in `settings.js`

```js
import { moltnetEditorTheme } from '@themoltnet/node-red-theme';

export default {
  editorTheme: moltnetEditorTheme({
    title: 'MoltNet',
  }),
};
```

To preserve existing page settings, pass them through the helper:

```js
import { moltnetEditorTheme } from '@themoltnet/node-red-theme';

export default {
  editorTheme: moltnetEditorTheme({
    title: 'MoltNet Flow Studio',
    favicon: '/theme/favicon/moltnet.svg',
  }),
};
```

The CSS is also exported directly:

```js
import { moltnetNodeRedThemeCssPath } from '@themoltnet/node-red-theme';

export default {
  editorTheme: {
    page: {
      css: moltnetNodeRedThemeCssPath,
    },
  },
};
```

For Node-RED instances that only need the stylesheet path, the package exposes
`@themoltnet/node-red-theme/moltnet.css`.
