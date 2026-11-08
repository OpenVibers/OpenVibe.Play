'use strict';
// What openvibe.play tells an agent about itself (openvibe-shared/agent-layer): /.well-known/agent.json.
// Every field is something this host really serves: the public read API at /api/v1 and the three ways in (none for
// reads, Network OIDC for people, a game's Network service token to write). The pages and the API guide moved to
// openvibe.games; this descriptor points there rather than at a page that 301s.
module.exports = {
    id: 'play',
    name: 'OpenVibe.Play',
    purpose: 'Achievements, weekly and all-time leaderboards and cloud saves for every OpenVibe game, with guests welcome and an SDK for developers.',
    home: 'https://openvibe.games/developers',
    site: 'play.openvibe.network',
    api: '/api/v1',
    docs: 'https://openvibe.games/developers',
    openapi: '/openapi.json',
    policy: {
        auth: ['none', 'Network OIDC', 'Network service token (Bearer, per game)'],
    },
};
