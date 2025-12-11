// via https://github.com/sindresorhus/slash/blob/main/index.js (MIT license)
module.exports = function slash(path) {
	const isExtendedLengthPath = path.startsWith('\\\\?\\');

	if (isExtendedLengthPath) {
		return path;
	}

	return path.replace(/\\/g, '/');
}
