const NovelFull = require('../../template/novelFull');

class CentralNovelProvider extends NovelFull {
    constructor() {
        super('novelbin', 'https://novelbin.com/');
        this.searchUrl = `${this.baseUrl}?search?keyword=%s`;
    }
}

module.exports = new CentralNovelProvider();