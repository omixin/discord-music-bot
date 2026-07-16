const ytdl = require('youtube-dl-exec');

async function test() {
    try {
        console.log('Searching...');
        const res = await ytdl(`ytsearch1:мой сларк`, {
            dumpSingleJson: true,
            noWarnings: true,
            callHome: false,
            noCheckCertificate: true,
            preferFreeFormats: true,
            youtubeSkipDashManifest: true,
        });
        console.log(res.entries[0].title);
        console.log(res.entries[0].webpage_url);
        
        console.log('Fetching stream info...');
        const streamInfo = await ytdl(res.entries[0].webpage_url, {
            dumpSingleJson: true,
            noWarnings: true,
            format: 'bestaudio'
        });
        console.log('Stream URL:', streamInfo.url.substring(0, 50) + '...');
    } catch (e) {
        console.error(e);
    }
}
test();
