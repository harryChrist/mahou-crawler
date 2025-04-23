const MangaStream = require('@/template/MangaStream');

class CentraNovelProvider extends MangaStream {
    constructor() {
        super('centralnovel', 'https://centralnovel.com', 'novel');
        this.searchUrl = `${this.baseUrl}/novels?titulo=%s`;
    }
}

module.exports = new CentraNovelProvider();