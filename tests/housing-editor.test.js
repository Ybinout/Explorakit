const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function component(file, vueFile = false) {
    let source = fs.readFileSync(file, 'utf8');
    if (vueFile) source = source.match(/<script>([\s\S]*?)<\/script>/)[1];
    source = source.replace(/^import[\s\S]*?;\s*$/gm, '')
        .replace('export default', 'module.exports =');
    const context = {
        module: { exports: {} },
        HousingTrashPanel: {}, BerryGardenPanel: {}, HousingEditor: {}, HousingItemIcon: {}, HousingModelPreview: {},
    };
    vm.runInNewContext(source, context);
    return context.module.exports.methods;
}
const game = component('vue-explorakit/src/services/housingGame.js');
const panel = component('vue-explorakit/src/components/housing/HousingPanel.vue', true);

for (const reason of ['rejected', 'timeout', 'sql']) {
    test('Housing save ' + reason + ': editable draft or stable confirmation ID', async () => {
        const pending = { name: 'save', data: { requestId: 'stable-request', revision: 3 } };
        const state = {
            housingPanel: {}, housingBusy: false,
            socket: { timeout() { return this; }, emit(_name, _data, callback) {
                callback(reason === 'timeout' ? Error('connection lost') : null,
                    { success: false, retryable: reason === 'sql', message: 'Refus de sauvegarde' });
            } },
        };
        const ui = { pending, dirty: true, command: game.housingCommand.bind(state) };
        await panel.retry.call(ui);
        assert.equal(state.housingBusy, false);
        assert(state.housingError);
        assert.equal(ui.dirty, true, 'the unsaved draft must remain intact');
        assert.equal(ui.pending, reason === 'rejected' ? null : pending);
        if (reason !== 'rejected') {
            ui.command = async (_name, data) => {
                assert.equal(data.requestId, 'stable-request');
                return { success: true };
            };
            await panel.retry.call(ui);
            assert.equal(ui.pending, null);
            assert.equal(ui.dirty, false);
        }
    });
}
