'use strict';
// What openvibe.play tells an agent about itself (openvibe-shared/agent-layer): /.well-known/agent.json.
// Every field is something this site really serves: the public read API at /api/v1, the developer guide at
// /docs, and the three ways in (none for reads, Network OIDC for people, a game's Network service token to write).
module.exports = {
    id: 'play',
    name: 'OpenVibe.Play',
    purpose: 'Achievements, weekly and all-time leaderboards and cloud saves for every OpenVibe game, with guests welcome and an SDK for developers.',
    home: 'https://play.openvibe.network',
    site: 'play.openvibe.network',
    api: '/api/v1',
    docs: '/docs',
    policy: {
        auth: ['none', 'Network OIDC', 'Network service token (Bearer, per game)'],
    },
};
