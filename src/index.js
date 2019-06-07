const i3 = require('i3');
const {exec} = require('child_process');
const {resolve} = require('path');

const CONFIG_PATH = resolve(require('os').homedir(), '.config', 'node-inactive-window-transparency.json');

const config = require('convict')({
  inactive: {
    doc: 'Inactive opacity',
    format: Number,
    default: 0.8,
    arg: 'inactive'
  },
  active: {
    doc: 'Active opacity',
    format: Number,
    default: 1,
    arg: 'active'
  },
  wm: {
    doc: 'sway or i3',
    format: ['sway', 'i3'],
    default: 'sway',
    arg: 'wm'
  },
  overrides: {
    doc: 'Overrides object',
    format: Object,
    default: {}
  }
});

try {
  config.loadFile(CONFIG_PATH);
} catch (e) {
  // eslint-disable-next-line no-console
  console.info(`You can set configuration at ${CONFIG_PATH}`);
}

const overrides = config.get('overrides');

const getOverride = node => node && node.window_properties && overrides[node.window_properties.class] !== undefined && overrides[node.window_properties.class] || 0;


const inactiveOpacity = config.get('inactive');
const activeOpacity = config.get('active');
const socketPathCommand = `${config.get('wm')} --get-socketpath`;

function * iterateNodes(root) {
  for (const node of root.nodes || []) {
    yield node;
    yield* iterateNodes(node);
  }
}

// socketPath : string -> Promise string
const socketPath = command => new Promise((res, rej) => {
  exec(command, (e, stdout) => {
    if (e) {
      return rej(e);
    }
    return res(stdout.replace('\n', ''));
  });
});

// createClient : () -> Promise client
const createClient = () => socketPath(socketPathCommand)
  .then(path => i3.createClient({path}));

// tree : client -> Promise root
const tree = client => new Promise((res, rej) => {
  client.tree((e, root) => {
    if (e) {
      return rej(e);
    }
    return res(root);
  });
});

// setInitialOpacity : client -> Effect
const setInitialOpacity = client => tree(client).then(root => {
  for (const node of iterateNodes(root)) {
    if (node.type === 'con' && node.nodes.length === 0) {
      if (node.focused) {
        client.command(`[con_id=${node.id}] opacity ${activeOpacity + getOverride(node)}`);
      } else {
        client.command(`[con_id=${node.id}] opacity ${inactiveOpacity + getOverride(node)}`);
      }
    }
  }
});


// watchFocus : client -> Effect
const watchFocus = client => {
  let lastContainer = null;
  client.on('window', ({change, container}) => {
    if (change !== 'focus') {
      return;
    }
    if (lastContainer) {
      client.command(`[con_id=${lastContainer.id}] opacity ${inactiveOpacity + getOverride(lastContainer)}`);
    }
    lastContainer = container;
    client.command(`opacity ${activeOpacity + getOverride(container)}`);
  });
};

createClient()
  .then(client => {
    [setInitialOpacity, watchFocus].forEach(fn => fn(client));
  });
