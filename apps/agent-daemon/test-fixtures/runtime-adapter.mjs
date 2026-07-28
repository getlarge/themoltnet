export default {
  runtimeKind: 'packed_smoke_pi',
  async prepare() {
    throw new Error('not called by the packed --help smoke test');
  },
};
