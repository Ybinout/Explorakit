// Dry run by default. Explicit accounts, ended-raid proofs and durable receipts
// prevent accidental re-grants. Save operator receipts outside public patch notes.
const args = process.argv.slice(2),
    value = (key) =>
        args.find((v) => v.startsWith(key + '='))?.slice(key.length + 1);
(async () => {
    try {
        const r =
            await require('../server/persistence/raidRecoveryRepository').recover(
                {
                    raidId: value('--raid'),
                    userIds: (value('--users') || '').split(',').map(Number),
                    dryRun: !args.includes('--apply'),
                }
            );
        console.log(JSON.stringify(r, null, 2));
    } finally {
        await require('../server/config/database').dbPool.end();
    }
})().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
});
