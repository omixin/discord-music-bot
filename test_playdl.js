const play = require('play-dl');

play.search('мой сларк', { limit: 1 }).then(res => {
    console.log(res[0]);
    console.log('URL IS:', res[0].url);
}).catch(console.error);
