'use strict';

var Promise = global.Promise;
var fs = require('node:fs');
var path = require('node:path');
var test = require('node:test');
var assert = require('node:assert');
var readDirFiles = require('read-dir-files');
var Transform = require('node:stream').Transform;

var slash = require('../../lib/slash.js');
// lib/copy keeps references to these at load time, so they must be mocked before it is required.
var originalMkdir = fs.promises.mkdir;
var originalSymlink = fs.promises.symlink;
var mkdirMock = test.mock.method(fs.promises, 'mkdir');
var symlinkMock = test.mock.method(fs.promises, 'symlink');
var copy = require('../../lib/copy');

var SOURCE_PATH = path.resolve(__dirname, '../fixtures/source');
var DESTINATION_PATH = path.resolve(__dirname, '../fixtures/destination');

var COPY_EVENTS = Object.keys(copy.events).map(function(key) {
	return copy.events[key];
});

var describe = test.describe;
var it = test.it;
var beforeEach = test.beforeEach;
var afterEach = test.afterEach;

describe('copy()', function() {
	beforeEach(function() {
		return fs.promises.mkdir(DESTINATION_PATH, { recursive: true });
	});

	afterEach(function() {
		return fs.promises.rm(DESTINATION_PATH, { recursive: true, force: true });
	});

	function getSourcePath(filename) {
		return path.join(SOURCE_PATH, filename);
	}

	function getDestinationPath(filename) {
		if (!filename) { return DESTINATION_PATH; }
		return path.join(DESTINATION_PATH, filename);
	}

	function getOutputFiles() {
		return new Promise(function(resolve, reject) {
			readDirFiles.read(DESTINATION_PATH, 'utf8', function(error, files) {
				if (error) {
					return reject(error);
				}
				return resolve(files);
			});
		});
	}

	function checkResults(results, expectedResults) {
		var actual, expected;
		actual = results.reduce(function(paths, copyOperation) {
			paths[copyOperation.src] = copyOperation.dest;
			return paths;
		}, {});
		expected = Object.keys(expectedResults).map(function(filename) {
			return {
				src: getSourcePath(filename),
				dest: getDestinationPath(filename)
			};
		}).reduce(function(paths, copyOperation) {
			paths[copyOperation.src] = copyOperation.dest;
			return paths;
		}, {});
		assert.deepStrictEqual(actual, expected);

		actual = results.reduce(function(stats, copyOperation) {
			stats[copyOperation.dest] = getFileType(copyOperation.stats);
			return stats;
		}, {});
		expected = Object.keys(expectedResults).map(function(filename) {
			return {
				dest: getDestinationPath(filename),
				type: expectedResults[filename]
			};
		}).reduce(function(paths, copyOperation) {
			paths[copyOperation.dest] = copyOperation.type;
			return paths;
		}, {});
		assert.deepStrictEqual(actual, expected);


		function getFileType(stats) {
			if (stats.isDirectory()) { return 'dir'; }
			if (stats.isSymbolicLink()) { return 'symlink'; }
			return 'file';
		}
	}

	function createSymbolicLink(src, dest, type) {
		var stats;
		try {
			stats = fs.lstatSync(dest);
		} catch (error) {
			if (error.code !== 'ENOENT') {
				throw error;
			}
		}
		if (!stats) {
			fs.symlinkSync(src, dest, type);
		} else if (!stats.isSymbolicLink()) {
			fs.unlinkSync(dest);
			fs.symlinkSync(src, dest, type);
		}
	}

	function listenTo(emitter, eventNames) {
		var events = [];
		eventNames.forEach(function(eventName) {
			emitter.on(eventName, createListener(eventName));
		});
		return events;


		function createListener(eventName) {
			return function(args) {
				events.push({
					name: eventName,
					args: Array.prototype.slice.call(arguments)
				});
			};
		}
	}

	function mockMkdirp(errors) {
		mkdirMock.mock.mockImplementation(function(path) {
			if (errors[path]) {
				return Promise.reject(errors[path]);
			}
			return originalMkdir.apply(this, arguments);
		});
		return function() {
			mkdirMock.mock.mockImplementation(originalMkdir);
		};
	}

	function mockSymlink() {
		symlinkMock.mock.mockImplementation(function() {
			return Promise.reject(new Error('Test error'));
		});
		return function() {
			symlinkMock.mock.mockImplementation(originalSymlink);
		};
	}

	describe('basic operation', function() {
		it('should copy single files', function() {
			return copy(
				getSourcePath('file'),
				getDestinationPath('file')
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							file: 'Hello, world!\n'
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should return results for single files', function() {
			return copy(
				getSourcePath('file'),
				getDestinationPath('file')
			).then(function(results) {
				checkResults(results, {
					'file': 'file'
				});
			});
		});

		it('should retain file modification dates', function() {
			return new Promise(function(resolve) {
				setTimeout(resolve, 1000)
			}).then(function() {
				return copy(
					getSourcePath('file'),
					getDestinationPath('file')
				);
			}).then(function(results) {
				var actual = fs.statSync(getDestinationPath('file')).mtime;
				var expected = fs.statSync(getSourcePath('file')).mtime;
				actual.setMilliseconds(0);
				expected.setMilliseconds(0);
				assert.deepStrictEqual(actual, expected);
			});
		});

		it('should retain file permissions', function() {
			return copy(
				getSourcePath('executable'),
				getDestinationPath('executable')
			).then(function(results) {
				var actual = fs.statSync(getDestinationPath('executable')).mode;
				var expected = fs.statSync(getSourcePath('executable')).mode;
				assert.strictEqual(actual, expected);
			});
		});

		it('should create parent directory if it does not exist', function() {
			return copy(
				getSourcePath('nested-file/file'),
				getDestinationPath('nested-file/file')
			).then(function(results) {
				checkResults(results, {
					'nested-file/file': 'file'
				});
			});
		});

		it('should copy empty directories', function() {
			return copy(
				getSourcePath('empty'),
				getDestinationPath('empty')
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'empty': {}
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should return results for empty directories', function() {
			return copy(
				getSourcePath('empty'),
				getDestinationPath('empty')
			).then(function(results) {
				checkResults(results, {
					'empty': 'dir'
				});
			});
		});

		it('should copy directories', function() {
			return copy(
				getSourcePath('directory'),
				getDestinationPath('directory')
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							directory: {
								a: 'a\n',
								b: 'b\n',
								c: 'c\n'
							}
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should return results for directories', function() {
			return copy(
				getSourcePath('directory'),
				getDestinationPath('directory')
			).then(function(results) {
				checkResults(results, {
					'directory': 'dir',
					'directory/a': 'file',
					'directory/b': 'file',
					'directory/c': 'file'
				});
			});
		});

		it('should copy nested directories', function() {
			return copy(
				getSourcePath('nested-directory'),
				getDestinationPath('nested-directory')
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'nested-directory': {
								'1': {
									'1-1': {
										'1-1-a': '1-1-a\n',
										'1-1-b': '1-1-b\n'
									},
									'1-2': {
										'1-2-a': '1-2-a\n',
										'1-2-b': '1-2-b\n'
									},
									'1-a': '1-a\n',
									'1-b': '1-b\n'
								},
								'2': {
									'2-1': {
										'2-1-a': '2-1-a\n',
										'2-1-b': '2-1-b\n'
									},
									'2-2': {
										'2-2-a': '2-2-a\n',
										'2-2-b': '2-2-b\n'
									},
									'2-a': '2-a\n',
									'2-b': '2-b\n'
								},
								'a': 'a\n',
								'b': 'b\n'
							}
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should return results for directories', function() {
			return copy(
				getSourcePath('nested-directory'),
				getDestinationPath('nested-directory')
			).then(function(results) {
				checkResults(results, {
					'nested-directory': 'dir',
					'nested-directory/1': 'dir',
					'nested-directory/1/1-1': 'dir',
					'nested-directory/1/1-1/1-1-a': 'file',
					'nested-directory/1/1-1/1-1-b': 'file',
					'nested-directory/1/1-2': 'dir',
					'nested-directory/1/1-2/1-2-a': 'file',
					'nested-directory/1/1-2/1-2-b': 'file',
					'nested-directory/1/1-a': 'file',
					'nested-directory/1/1-b': 'file',
					'nested-directory/2': 'dir',
					'nested-directory/2/2-1': 'dir',
					'nested-directory/2/2-1/2-1-a': 'file',
					'nested-directory/2/2-1/2-1-b': 'file',
					'nested-directory/2/2-2': 'dir',
					'nested-directory/2/2-2/2-2-a': 'file',
					'nested-directory/2/2-2/2-2-b': 'file',
					'nested-directory/2/2-a': 'file',
					'nested-directory/2/2-b': 'file',
					'nested-directory/a': 'file',
					'nested-directory/b': 'file'
				});
			});
		});

		it('should merge directories into existing directories', function() {
			return copy(
				getSourcePath('nested-directory'),
				getDestinationPath()
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'1': {
								'1-1': {
									'1-1-a': '1-1-a\n',
									'1-1-b': '1-1-b\n'
								},
								'1-2': {
									'1-2-a': '1-2-a\n',
									'1-2-b': '1-2-b\n'
								},
								'1-a': '1-a\n',
								'1-b': '1-b\n'
							},
							'2': {
								'2-1': {
									'2-1-a': '2-1-a\n',
									'2-1-b': '2-1-b\n'
								},
								'2-2': {
									'2-2-a': '2-2-a\n',
									'2-2-b': '2-2-b\n'
								},
								'2-a': '2-a\n',
								'2-b': '2-b\n'
							},
							'a': 'a\n',
							'b': 'b\n'
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should copy symlinks', function() {
			createSymbolicLink('.', getSourcePath('symlink'), 'dir');
			return copy(
				getSourcePath('symlink'),
				getDestinationPath('symlink')
			).then(function(results) {
				var actual, expected;
				actual = fs.readlinkSync(getDestinationPath('symlink'));
				expected = '.';
				assert.strictEqual(actual, expected);
			});
		});

		it('should return results for symlinks', function() {
			createSymbolicLink('.', getSourcePath('symlink'), 'dir');
			return copy(
				getSourcePath('symlink'),
				getDestinationPath('symlink')
			).then(function(results) {
				checkResults(results, {
					'symlink': 'symlink'
				});
			});
		});

		it('should copy nested symlinks', function() {
			createSymbolicLink('../file', getSourcePath('nested-symlinks/file'), 'file');
			createSymbolicLink('../directory', getSourcePath('nested-symlinks/directory'), 'dir');
			createSymbolicLink('../../directory', getSourcePath('nested-symlinks/nested/directory'), 'dir');
			return copy(
				getSourcePath('nested-symlinks'),
				getDestinationPath('nested-symlinks')
			).then(function(results) {
				var actual, expected;
				actual = slash(fs.readlinkSync(getDestinationPath('nested-symlinks/file')));
				expected = '../file';
				assert.strictEqual(actual, expected);
				actual = slash(fs.readlinkSync(getDestinationPath('nested-symlinks/directory')));
				expected = '../directory';
				assert.strictEqual(actual, expected);
				actual = slash(fs.readlinkSync(getDestinationPath('nested-symlinks/nested/directory')));
				expected = '../../directory';
				assert.strictEqual(actual, expected);
			});
		});

		it('should return results for nested symlinks', function() {
			createSymbolicLink('../file', getSourcePath('nested-symlinks/file'), 'file');
			createSymbolicLink('../directory', getSourcePath('nested-symlinks/directory'), 'dir');
			createSymbolicLink('../../directory', getSourcePath('nested-symlinks/nested/directory'), 'dir');
			return copy(
				getSourcePath('nested-symlinks'),
				getDestinationPath('nested-symlinks')
			).then(function(results) {
				checkResults(results, {
					'nested-symlinks': 'dir',
					'nested-symlinks/file': 'symlink',
					'nested-symlinks/directory': 'symlink',
					'nested-symlinks/nested': 'dir',
					'nested-symlinks/nested/directory': 'symlink'
				});
			});
		});
	});

	describe('options', function() {

		it('should overwrite destination file if overwrite is specified', function() {
			fs.writeFileSync(getDestinationPath('file'), 'Goodbye, world!');

			return copy(
				getSourcePath('file'),
				getDestinationPath('file'),
				{
					overwrite: true
				}
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							file: 'Hello, world!\n'
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should overwrite destination symlink if overwrite is specified', function() {
			fs.symlinkSync('./symlink', getDestinationPath('file'), 'file');

			return copy(
				getSourcePath('file'),
				getDestinationPath('file'),
				{
					overwrite: true
				}
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							file: 'Hello, world!\n'
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should overwrite destination directory if overwrite is specified', function() {
			fs.mkdirSync(getDestinationPath('file'));

			return copy(
				getSourcePath('file'),
				getDestinationPath('file'),
				{
					overwrite: true
				}
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							file: 'Hello, world!\n'
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should not copy dotfiles if dotfiles is not specified', function() {
			return copy(
				getSourcePath('dotfiles'),
				getDestinationPath()
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'a': 'a\n',
							'b': 'b\n'
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should not copy dotfiles if dotfile is referenced directly', function() {
			return copy(
				getSourcePath('dotfiles/.a'),
				getDestinationPath()
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should copy dotfiles if dotfiles is specified', function() {
			return copy(
				getSourcePath('dotfiles'),
				getDestinationPath(),
				{
					dot: true
				}
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'.a': '.a\n',
							'.b': '.b\n',
							'a': 'a\n',
							'b': 'b\n'
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should not copy junk files if junk is not specified', function() {
			return copy(
				getSourcePath('junk'),
				getDestinationPath()
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'a': 'a\n',
							'b': 'b\n'
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should copy junk files if junk is specified', function() {
			return copy(
				getSourcePath('junk'),
				getDestinationPath(),
				{
					junk: true
				}
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'a': 'a\n',
							'b': 'b\n',
							'npm-debug.log': 'npm-debug.log\n',
							'Thumbs.db': 'Thumbs.db\n'
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should expand symlinked source files if expand is specified', function() {
			createSymbolicLink('./file', getSourcePath('file-symlink'), 'file');
			return copy(
				getSourcePath('file-symlink'),
				getDestinationPath('expanded-file-symlink'),
				{
					expand: true
				}
			).then(function(results) {
				var actual = fs.lstatSync(getDestinationPath('expanded-file-symlink')).isSymbolicLink();
				var expected = false;
				assert.strictEqual(actual, expected);
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'expanded-file-symlink': 'Hello, world!\n'
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should expand symlinked source directories if expand is specified', function() {
			createSymbolicLink('./directory', getSourcePath('directory-symlink'), 'dir');
			return copy(
				getSourcePath('directory-symlink'),
				getDestinationPath('directory-symlink'),
				{
					expand: true
				}
			).then(function(results) {
				var actual = fs.lstatSync(getDestinationPath('directory-symlink')).isSymbolicLink();
				var expected = false;
				assert.strictEqual(actual, expected);
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'directory-symlink': {
								'a': 'a\n',
								'b': 'b\n',
								'c': 'c\n'
							}
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should expand nested symlinks if expand is specified', function() {
			createSymbolicLink('../file', getSourcePath('nested-symlinks/file'), 'file');
			createSymbolicLink('../directory', getSourcePath('nested-symlinks/directory'), 'dir');
			createSymbolicLink('../../directory', getSourcePath('nested-symlinks/nested/directory'), 'dir');
			return copy(
				getSourcePath('nested-symlinks'),
				getDestinationPath('expanded-nested-symlinks'),
				{
					expand: true
				}
			).then(function(results) {
				var actual, expected;
				actual = fs.lstatSync(getDestinationPath('expanded-nested-symlinks')).isSymbolicLink();
				expected = false;
				assert.strictEqual(actual, expected);
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'expanded-nested-symlinks': {
								'file': 'Hello, world!\n',
								'directory': {
									'a': 'a\n',
									'b': 'b\n',
									'c': 'c\n'
								},
								'nested': {
									'directory': {
										'a': 'a\n',
										'b': 'b\n',
										'c': 'c\n'
									}
								}
							}
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});
	});

	describe('output transformation', function() {
		it('should filter output files via function', function() {
			return copy(
				getSourcePath('nested-directory'),
				getDestinationPath(),
				{
					filter: function(filePath) {
						var filename = path.basename(filePath);
						return (filePath === '1') || (filename.charAt(0) !== '1');
					}
				}
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'1': {},
							'2': {
								'2-1': {
									'2-1-a': '2-1-a\n',
									'2-1-b': '2-1-b\n'
								},
								'2-2': {
									'2-2-a': '2-2-a\n',
									'2-2-b': '2-2-b\n'
								},
								'2-a': '2-a\n',
								'2-b': '2-b\n'
							},
							'a': 'a\n',
							'b': 'b\n'
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should filter raw source paths via rawPathFilter', function() {
			var sourcePath = getSourcePath('nested-directory');
			var receivedPaths = [];
			return copy(
				sourcePath,
				getDestinationPath(),
				{
					rawPathFilter: function(filePath) {
						// Filters receive forward-slash paths, even on Windows.
						filePath = path.normalize(filePath);
						receivedPaths.push(filePath);
						var filename = path.basename(filePath);
						return (filePath === path.join(sourcePath, '1')) || (filename.charAt(0) !== '1');
					}
				}
			).then(function(results) {
				assert.ok(receivedPaths.length > 0);
				receivedPaths.forEach(function(filePath) {
					assert.ok(path.isAbsolute(filePath));
					assert.ok(filePath.startsWith(sourcePath));
				});
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'1': {},
							'2': {
								'2-1': {
									'2-1-a': '2-1-a\n',
									'2-1-b': '2-1-b\n'
								},
								'2-2': {
									'2-2-a': '2-2-a\n',
									'2-2-b': '2-2-b\n'
								},
								'2-a': '2-a\n',
								'2-b': '2-b\n'
							},
							'a': 'a\n',
							'b': 'b\n'
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should filter output files via regular expression', function() {
			return copy(
				getSourcePath('nested-directory'),
				getDestinationPath(),
				{
					filter: /(^[^1].*$)|(^1$)/
				}
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'1': {},
							'2': {
								'2-1': {
									'2-1-a': '2-1-a\n',
									'2-1-b': '2-1-b\n'
								},
								'2-2': {
									'2-2-a': '2-2-a\n',
									'2-2-b': '2-2-b\n'
								},
								'2-a': '2-a\n',
								'2-b': '2-b\n'
							},
							'a': 'a\n',
							'b': 'b\n'
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should filter output files via glob', function() {
			return copy(
				getSourcePath('nested-directory'),
				getDestinationPath(),
				{
					filter: '2/**/*'
				}
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'2': {
								'2-1': {
									'2-1-a': '2-1-a\n',
									'2-1-b': '2-1-b\n'
								},
								'2-2': {
									'2-2-a': '2-2-a\n',
									'2-2-b': '2-2-b\n'
								},
								'2-a': '2-a\n',
								'2-b': '2-b\n'
							}
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should combine multiple filters from arrays', function() {
			return copy(
				getSourcePath('nested-directory'),
				getDestinationPath(),
				{
					filter: [
						'1/**/*',
						'!1/1-1/**/*',
						/^2\/(?!2-1\/).*$/,
						function(filePath) {
							return filePath === 'a';
						}
					]
				}
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'1': {
								'1-1': {},
								'1-2': {
									'1-2-a': '1-2-a\n',
									'1-2-b': '1-2-b\n'
								},
								'1-a': '1-a\n',
								'1-b': '1-b\n'
							},
							'2': {
								'2-1': {
								},
								'2-2': {
									'2-2-a': '2-2-a\n',
									'2-2-b': '2-2-b\n'
								},
								'2-a': '2-a\n',
								'2-b': '2-b\n'
							},
							'a': 'a\n'
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should rename files', function() {
			return copy(
				getSourcePath('nested-directory'),
				getDestinationPath(),
				{
					rename: function(path) {
						if (path === 'b') { return 'c'; }
						return path;
					}
				}
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'1': {
								'1-1': {
									'1-1-a': '1-1-a\n',
									'1-1-b': '1-1-b\n'
								},
								'1-2': {
									'1-2-a': '1-2-a\n',
									'1-2-b': '1-2-b\n'
								},
								'1-a': '1-a\n',
								'1-b': '1-b\n'
							},
							'2': {
								'2-1': {
									'2-1-a': '2-1-a\n',
									'2-1-b': '2-1-b\n'
								},
								'2-2': {
									'2-2-a': '2-2-a\n',
									'2-2-b': '2-2-b\n'
								},
								'2-a': '2-a\n',
								'2-b': '2-b\n'
							},
							'a': 'a\n',
							'c': 'b\n'
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should rename file paths', function() {
			return copy(
				getSourcePath('nested-directory'),
				getDestinationPath(),
				{
					rename: function(path) {
						return path.replace(/^2/, '3').replace(/[/\\]2/g, '/3');
					}
				}
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'1': {
								'1-1': {
									'1-1-a': '1-1-a\n',
									'1-1-b': '1-1-b\n'
								},
								'1-2': {
									'1-2-a': '1-2-a\n',
									'1-2-b': '1-2-b\n'
								},
								'1-a': '1-a\n',
								'1-b': '1-b\n'
							},
							'3': {
								'3-1': {
									'3-1-a': '2-1-a\n',
									'3-1-b': '2-1-b\n'
								},
								'3-2': {
									'3-2-a': '2-2-a\n',
									'3-2-b': '2-2-b\n'
								},
								'3-a': '2-a\n',
								'3-b': '2-b\n'
							},
							'a': 'a\n',
							'b': 'b\n'
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should rename files into parent paths', function() {
			return copy(
				getSourcePath('nested-directory'),
				getDestinationPath('parent'),
				{
					rename: function(path) {
						return path.replace(/^2/, '../3').replace(/[/\\]2/g, '/3');
					}
				}
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'parent': {
								'1': {
									'1-1': {
										'1-1-a': '1-1-a\n',
										'1-1-b': '1-1-b\n'
									},
									'1-2': {
										'1-2-a': '1-2-a\n',
										'1-2-b': '1-2-b\n'
									},
									'1-a': '1-a\n',
									'1-b': '1-b\n'
								},
								'a': 'a\n',
								'b': 'b\n'
							},
							'3': {
								'3-1': {
									'3-1-a': '2-1-a\n',
									'3-1-b': '2-1-b\n'
								},
								'3-2': {
									'3-2-a': '2-2-a\n',
									'3-2-b': '2-2-b\n'
								},
								'3-a': '2-a\n',
								'3-b': '2-b\n'
							}
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should rename files into child paths', function() {
			return copy(
				getSourcePath('nested-directory'),
				getDestinationPath(),
				{
					rename: function(path) {
						return path.replace(/^2/, 'child/3').replace(/[/\\]2/g, '/3');
					}
				}
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'1': {
								'1-1': {
									'1-1-a': '1-1-a\n',
									'1-1-b': '1-1-b\n'
								},
								'1-2': {
									'1-2-a': '1-2-a\n',
									'1-2-b': '1-2-b\n'
								},
								'1-a': '1-a\n',
								'1-b': '1-b\n'
							},
							'a': 'a\n',
							'b': 'b\n',
							'child': {
								'3': {
									'3-1': {
										'3-1-a': '2-1-a\n',
										'3-1-b': '2-1-b\n'
									},
									'3-2': {
										'3-2-a': '2-2-a\n',
										'3-2-b': '2-2-b\n'
									},
									'3-a': '2-a\n',
									'3-b': '2-b\n'
								}
							}
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should filter files before renaming', function() {
			return copy(
				getSourcePath('nested-directory'),
				getDestinationPath(),
				{
					filter: function(path) {
						return path === 'a';
					},
					rename: function(path) {
						if (path === 'a') { return 'b'; }
						return path;
					}
				}
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'b': 'a\n'
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should transform files', function() {
			var transformArguments = null;
			return copy(
				getSourcePath('file'),
				getDestinationPath('file'),
				{
					transform: function(src, dest, stats) {
						transformArguments = arguments;
						return new Transform({ transform: function(chunk, enc, done) {
							done(null, chunk.toString().toUpperCase());
						} });
					}
				}
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'file': 'HELLO, WORLD!\n'
						};
						assert.deepStrictEqual(actual, expected);
						assert.notEqual(transformArguments, null);
						assert.deepStrictEqual(transformArguments.length, 3);
						assert.strictEqual(transformArguments[0], getSourcePath('file'));
						assert.strictEqual(transformArguments[1], getDestinationPath('file'));
						assert.notEqual(transformArguments[2], null);
						assert.notEqual(transformArguments[2].isFile, null);
						assert.ok(transformArguments[2].isFile());
					});
			});
		});

		it('should allow transform to be skipped', function() {
			return copy(
				getSourcePath('directory'),
				getDestinationPath('directory'),
				{
					transform: function(src, dest, stats) {
						if (path.basename(src) === 'b') { return null; }
						return new Transform({ transform: function(chunk, enc, done) {
							done(null, chunk.toString().toUpperCase());
						} });
					}
				}
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'directory': {
								'a': 'A\n',
								'b': 'b\n',
								'c': 'C\n'
							}
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should throw an error on a transform stream error', function() {
			var actual, expected;
			expected = 'Stream error';
			actual = copy(
				getSourcePath('file'),
				getDestinationPath('file'),
				{
					transform: function(src, dest, stats) {
						return new Transform({ transform: function(chunk, enc, done) {
							done(new Error('Stream error'));
						} });
					}
				}
			);
			return assert.rejects(actual, { message: new RegExp(expected) });
		});

		it('should throw the original error on nested file error', function() {
			return copy(
				getSourcePath('nested-directory'),
				getDestinationPath('nested-directory'),
				{
					transform: function(src, dest, stats) {
						return new Transform({ transform: function(chunk, enc, done) {
							if (src === getSourcePath('nested-directory/1/1-1/1-1-a')) {
								done(new Error('Stream error'));
							} else {
								done(null, chunk);
							}
						} });
					}
				}
			).then(function() {
				throw new Error('Should throw error');
			}).catch(function(error) {
				var actual, expected;

				actual = error.name;
				expected = 'Error';
				assert.strictEqual(actual, expected);

				actual = error.message;
				expected = 'Stream error';
				assert.strictEqual(actual, expected);
			});
		});
	});

	describe('file copy method', function() {
		var copyFileMock;

		beforeEach(function() {
			copyFileMock = test.mock.method(fs.promises, 'copyFile');
		});

		afterEach(function() {
			copyFileMock.mock.restore();
		});

		it('should use fs.copyFile by default', function() {
			return copy(getSourcePath('file'), getDestinationPath('file'))
				.then(function() {
					assert.strictEqual(copyFileMock.mock.callCount(), 1);
					assert.strictEqual(fs.readFileSync(getDestinationPath('file'), 'utf8'), 'Hello, world!\n');
				});
		});

		it('should use streams if streams is specified', function() {
			return copy(getSourcePath('file'), getDestinationPath('file'), { streams: true })
				.then(function() {
					assert.strictEqual(copyFileMock.mock.callCount(), 0);
					assert.strictEqual(fs.readFileSync(getDestinationPath('file'), 'utf8'), 'Hello, world!\n');
				});
		});
	});

	describe('shouldCopy()', function() {
		it('should skip dotfiles and junk files by default', function() {
			assert.strictEqual(copy.shouldCopy('a/b'), true);
			assert.strictEqual(copy.shouldCopy('a/.b'), false);
			assert.strictEqual(copy.shouldCopy('a/Thumbs.db'), false);
		});

		it('should keep dotfiles but not junk files with dot', function() {
			assert.strictEqual(copy.shouldCopy('a/.b', { dot: true }), true);
			assert.strictEqual(copy.shouldCopy('a/.DS_Store', { dot: true }), false);
		});

		it('should keep junk files with junk', function() {
			assert.strictEqual(copy.shouldCopy('a/Thumbs.db', { junk: true }), true);
			assert.strictEqual(copy.shouldCopy('a/.DS_Store', { junk: true }), false);
			assert.strictEqual(copy.shouldCopy('a/.DS_Store', { dot: true, junk: true }), true);
		});
	});

	describe('argument validation', function() {

		it('should throw an error if the source path does not exist', function() {
			var actual, expected;
			actual = copy(
				'nonexistent',
				getDestinationPath()
			);
			expected = 'ENOENT';
			return assert.rejects(actual, { message: new RegExp(expected) });
		});

		it('should throw an error if the destination path exists (single file)', function() {
			fs.writeFileSync(getDestinationPath('file'), '');

			var actual, expected;
			actual = copy(
				getSourcePath('file'),
				getDestinationPath('file')
			);
			expected = 'EEXIST';
			return assert.rejects(actual, { message: new RegExp(expected) });
		});

		it('should not throw an error if an nonconflicting file exists within the destination path (single file)', function() {
			fs.writeFileSync(getDestinationPath('pre-existing'), '');

			return copy(
				getSourcePath('file'),
				getDestinationPath('file')
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'pre-existing': '',
							'file': 'Hello, world!\n'
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});

		it('should throw an error if a conflicting file exists within the destination path (directory)', function() {
			fs.writeFileSync(getDestinationPath('a'), '');

			var actual, expected;
			actual = copy(
				getSourcePath('nested-directory'),
				getDestinationPath()
			);
			expected = 'EEXIST';
			return assert.rejects(actual, { message: new RegExp(expected) });
		});

		it('should not throw an error if an nonconflicting file exists within the destination path (directory)', function() {
			fs.writeFileSync(getDestinationPath('pre-existing'), '');

			return copy(
				getSourcePath('nested-directory'),
				getDestinationPath()
			).then(function(results) {
				return getOutputFiles()
					.then(function(files) {
						var actual, expected;
						actual = files;
						expected = {
							'pre-existing': '',
							'1': {
								'1-1': {
									'1-1-a': '1-1-a\n',
									'1-1-b': '1-1-b\n'
								},
								'1-2': {
									'1-2-a': '1-2-a\n',
									'1-2-b': '1-2-b\n'
								},
								'1-a': '1-a\n',
								'1-b': '1-b\n'
							},
							'2': {
								'2-1': {
									'2-1-a': '2-1-a\n',
									'2-1-b': '2-1-b\n'
								},
								'2-2': {
									'2-2-a': '2-2-a\n',
									'2-2-b': '2-2-b\n'
								},
								'2-a': '2-a\n',
								'2-b': '2-b\n'
							},
							'a': 'a\n',
							'b': 'b\n'
						};
						assert.deepStrictEqual(actual, expected);
					});
			});
		});
	});

	describe('callbacks', function() {
		it('should invoke the callback on success (without options)', function(t, done) {
			copy(
				getSourcePath('file'),
				getDestinationPath('file'),
				function(error, results) {
					assert.notEqual(results, null);
					assert.equal(error, null);

					checkResults(results, {
						'file': 'file'
					});

					done();
				}
			);
		});

		it('should invoke the callback on failure (without options)', function(t, done) {
			copy(
				'nonexistent',
				getDestinationPath(),
				function(error, results) {
					assert.notEqual(error, null);
					assert.equal(results, null);

					var actual, expected;
					actual = error.code;
					expected = 'ENOENT';
					assert.strictEqual(actual, expected);

					done();
				}
			);
		});

		it('should invoke the callback on success (with options)', function(t, done) {
			copy(
				getSourcePath('file'),
				getDestinationPath('file'),
				{ },
				function(error, results) {
					assert.notEqual(results, null);
					assert.equal(error, null);

					checkResults(results, {
						'file': 'file'
					});

					done();
				}
			);
		});
		it('should invoke the callback on failure (with options)', function(t, done) {
			copy(
				'nonexistent',
				getDestinationPath(),
				{},
				function(error, results) {
					assert.notEqual(error, null);
					assert.equal(results, null);

					var actual, expected;
					actual = error.code;
					expected = 'ENOENT';
					assert.strictEqual(actual, expected);

					done();
				}
			);
		});
	});

	describe('events', function() {
		it('should export event names and values', function() {
			var actual, expected;
			actual = copy.events;
			expected = {
				ERROR: 'error',
				COMPLETE: 'complete',
				CREATE_DIRECTORY_START: 'createDirectoryStart',
				CREATE_DIRECTORY_ERROR: 'createDirectoryError',
				CREATE_DIRECTORY_COMPLETE: 'createDirectoryComplete',
				CREATE_SYMLINK_START: 'createSymlinkStart',
				CREATE_SYMLINK_ERROR: 'createSymlinkError',
				CREATE_SYMLINK_COMPLETE: 'createSymlinkComplete',
				COPY_FILE_START: 'copyFileStart',
				COPY_FILE_ERROR: 'copyFileError',
				COPY_FILE_COMPLETE: 'copyFileComplete'
			};
			assert.deepStrictEqual(actual, expected);
		});

		it('should allow event listeners to be chained', function() {
			var copier = copy(
				getSourcePath('file'),
				getDestinationPath('file')
			);
			assert.doesNotThrow(function() {
					copier
						.on('error', function() {})
						.on('complete', function() {})
						.on('createDirectoryStart', function() {})
						.on('createDirectoryError', function() {})
						.on('createDirectoryComplete', function() {})
						.on('createSymlinkStart', function() {})
						.on('createSymlinkError', function() {})
						.on('createSymlinkComplete', function() {})
						.on('copyFileStart', function() {})
						.on('copyFileError', function() {})
						.on('copyFileComplete', function() {})
						.then(function() { })
						.catch(function() { });
			});
			return copier;
		});

		it('should emit file copy events', function() {
			var copier = copy(
				getSourcePath('file'),
				getDestinationPath('file')
			);
			var events = listenTo(copier, COPY_EVENTS);
			return copier.then(function() {
				var actual, expected;

				var eventNames = events.map(function(event) {
					return event.name;
				});

				actual = eventNames;
				expected = ['copyFileStart', 'copyFileComplete', 'complete'];
				assert.deepStrictEqual(actual, expected);

				var completeEvent = events.filter(function(event) {
					return event.name === 'complete';
				})[0];
				var eventArgs = completeEvent.args;

				actual = eventArgs.length;
				expected = 1;
				assert.strictEqual(actual, expected);

				var results = eventArgs[0];
				checkResults(results, {
					'file': 'file'
				});
			});
		});

		it('should emit error events', function() {
			fs.writeFileSync(getDestinationPath('file'), '');

			var copier = copy(
				getSourcePath('file'),
				getDestinationPath('file')
			);
			var events = listenTo(copier, COPY_EVENTS);
			return copier.then(function() {
				throw new Error('Should throw error');
			}, function() {
				var actual, expected;

				var eventNames = events.map(function(event) {
					return event.name;
				});

				actual = eventNames;
				expected = ['error'];
				assert.deepStrictEqual(actual, expected);

				var errorEvent = events.filter(function(event) {
					return event.name === 'error';
				})[0];
				var eventArgs = errorEvent.args;

				actual = eventArgs.length;
				expected = 2;
				assert.strictEqual(actual, expected);

				var error = eventArgs[0];
				var copyOperation = eventArgs[1];

				actual = error.code;
				expected = 'EEXIST';
				assert.strictEqual(actual, expected);

				actual = copyOperation.src;
				expected = getSourcePath('file');
				assert.strictEqual(actual, expected);

				actual = copyOperation.dest;
				expected = getDestinationPath('file');
				assert.strictEqual(actual, expected);
			});
		});

		it('should emit file copy error events', function() {
			var copier = copy(
				getSourcePath('file'),
				getDestinationPath('file'),
				{
					transform: function(src, dest, stats) {
						return new Transform({ transform: function(chunk, enc, done) {
							done(new Error('Stream error'));
						} });
					}
				}
			);
			var events = listenTo(copier, COPY_EVENTS);
			return copier.then(function() {
				throw new Error('Should throw error');
			}, function() {
				var actual, expected;

				var eventNames = events.map(function(event) {
					return event.name;
				});

				actual = eventNames;
				expected = ['copyFileStart', 'copyFileError', 'error'];
				assert.deepStrictEqual(actual, expected);


				var errorEvent = events.filter(function(event) {
					return event.name === 'error';
				})[0];
				var eventArgs = errorEvent.args;

				actual = eventArgs.length;
				expected = 2;
				assert.strictEqual(actual, expected);

				var error = eventArgs[0];
				var copyOperation = eventArgs[1];

				actual = error.message;
				expected = 'Stream error';
				assert.strictEqual(actual, expected);

				actual = copyOperation.src;
				expected = getSourcePath('file');
				assert.strictEqual(actual, expected);

				actual = copyOperation.dest;
				expected = getDestinationPath('file');
				assert.strictEqual(actual, expected);


				var fileErrorEvent = events.filter(function(event) {
					return event.name === 'copyFileError';
				})[0];
				var fileErrorEventArgs = fileErrorEvent.args;

				actual = fileErrorEventArgs.length;
				expected = 2;
				assert.strictEqual(actual, expected);

				var fileError = fileErrorEventArgs[0];
				var fileCopyOperation = fileErrorEventArgs[1];

				actual = fileError.message;
				expected = 'Stream error';
				assert.strictEqual(actual, expected);

				actual = fileCopyOperation.src;
				expected = getSourcePath('file');
				assert.strictEqual(actual, expected);

				actual = fileCopyOperation.dest;
				expected = getDestinationPath('file');
				assert.strictEqual(actual, expected);

				actual = fileCopyOperation.stats && fileCopyOperation.stats.isDirectory;
				expected = 'function';
				assert.strictEqual(typeof actual, expected);
			});
		});

		it('should emit directory copy events', function() {
			var copier = copy(
				getSourcePath('empty'),
				getDestinationPath('empty')
			);
			var events = listenTo(copier, COPY_EVENTS);
			return copier.then(function() {
				var actual, expected;

				var eventNames = events.map(function(event) {
					return event.name;
				});

				actual = eventNames;
				expected = ['createDirectoryStart', 'createDirectoryComplete', 'complete'];
				assert.deepStrictEqual(actual, expected);

				var completeEvent = events.filter(function(event) {
					return event.name === 'complete';
				})[0];
				var eventArgs = completeEvent.args;

				actual = eventArgs.length;
				expected = 1;
				assert.strictEqual(actual, expected);

				var results = eventArgs[0];
				checkResults(results, {
					'empty': 'dir'
				});
			});
		});

		it('should emit directory copy error events', function() {
			var errors = {};
			errors[getDestinationPath('empty')] = new Error('Test error');
			var unmockMkdirp = mockMkdirp(errors);

			var copier = copy(
				getSourcePath('empty'),
				getDestinationPath('empty')
			);
			var events = listenTo(copier, COPY_EVENTS);
			return copier.then(function() {
				throw new Error('Should throw error');
			}, function() {
				var actual, expected;

				var eventNames = events.map(function(event) {
					return event.name;
				});

				actual = eventNames;
				expected = ['createDirectoryStart', 'createDirectoryError', 'error'];
				assert.deepStrictEqual(actual, expected);


				var errorEvent = events.filter(function(event) {
					return event.name === 'error';
				})[0];
				var eventArgs = errorEvent.args;

				actual = eventArgs.length;
				expected = 2;
				assert.strictEqual(actual, expected);

				var error = eventArgs[0];
				var copyOperation = eventArgs[1];

				actual = error.message;
				expected = 'Test error';
				assert.strictEqual(actual, expected);

				actual = copyOperation.src;
				expected = getSourcePath('empty');
				assert.strictEqual(actual, expected);

				actual = copyOperation.dest;
				expected = getDestinationPath('empty');
				assert.strictEqual(actual, expected);


				var directoryErrorEvent = events.filter(function(event) {
					return event.name === 'createDirectoryError';
				})[0];
				var directoryErrorEventArgs = directoryErrorEvent.args;

				actual = directoryErrorEventArgs.length;
				expected = 2;
				assert.strictEqual(actual, expected);

				var directoryError = directoryErrorEventArgs[0];
				var directoryCopyOperation = directoryErrorEventArgs[1];

				actual = directoryError.message;
				expected = 'Test error';
				assert.strictEqual(actual, expected);

				actual = directoryCopyOperation.src;
				expected = getSourcePath('empty');
				assert.strictEqual(actual, expected);

				actual = directoryCopyOperation.dest;
				expected = getDestinationPath('empty');
				assert.strictEqual(actual, expected);

				actual = directoryCopyOperation.stats && directoryCopyOperation.stats.isDirectory;
				expected = 'function';
				assert.strictEqual(typeof actual, expected);
			}).finally(unmockMkdirp);
		});

		it('should emit symlink copy error events', function() {
			createSymbolicLink('.', getSourcePath('symlink'), 'dir');
			var unmockSymlink = mockSymlink();

			var copier = copy(
				getSourcePath('symlink'),
				getDestinationPath('symlink')
			);
			var events = listenTo(copier, COPY_EVENTS);
			return copier.then(function() {
				throw new Error('Should throw error');
			}, function() {
				var actual, expected;

				var eventNames = events.map(function(event) {
					return event.name;
				});

				actual = eventNames;
				expected = ['createSymlinkStart', 'createSymlinkError', 'error'];
				assert.deepStrictEqual(actual, expected);


				var errorEvent = events.filter(function(event) {
					return event.name === 'error';
				})[0];
				var eventArgs = errorEvent.args;

				actual = eventArgs.length;
				expected = 2;
				assert.strictEqual(actual, expected);

				var error = eventArgs[0];
				var copyOperation = eventArgs[1];

				actual = error.message;
				expected = 'Test error';
				assert.strictEqual(actual, expected);

				actual = copyOperation.src;
				expected = getSourcePath('symlink');
				assert.strictEqual(actual, expected);

				actual = copyOperation.dest;
				expected = getDestinationPath('symlink');
				assert.strictEqual(actual, expected);


				var symlinkErrorEvent = events.filter(function(event) {
					return event.name === 'createSymlinkError';
				})[0];
				var symlinkErrorEventArgs = symlinkErrorEvent.args;

				actual = symlinkErrorEventArgs.length;
				expected = 2;
				assert.strictEqual(actual, expected);

				var symlinkError = symlinkErrorEventArgs[0];
				var symlinkCopyOperation = symlinkErrorEventArgs[1];

				actual = symlinkError.message;
				expected = 'Test error';
				assert.strictEqual(actual, expected);

				actual = symlinkCopyOperation.src;
				expected = getSourcePath('symlink');
				assert.strictEqual(actual, expected);

				actual = symlinkCopyOperation.dest;
				expected = getDestinationPath('symlink');
				assert.strictEqual(actual, expected);

				actual = symlinkCopyOperation.stats && symlinkCopyOperation.stats.isDirectory;
				expected = 'function';
				assert.strictEqual(typeof actual, expected);
			}).finally(unmockSymlink);
		});

		it('should emit symlink copy events', function() {
			createSymbolicLink('.', getSourcePath('symlink'), 'dir');
			var copier = copy(
				getSourcePath('symlink'),
				getDestinationPath('symlink')
			);
			var events = listenTo(copier, COPY_EVENTS);
			return copier.then(function() {
				var actual, expected;

				var eventNames = events.map(function(event) {
					return event.name;
				});

				actual = eventNames;
				expected = ['createSymlinkStart', 'createSymlinkComplete', 'complete'];
				assert.deepStrictEqual(actual, expected);

				var completeEvent = events.filter(function(event) {
					return event.name === 'complete';
				})[0];
				var eventArgs = completeEvent.args;

				actual = eventArgs.length;
				expected = 1;
				assert.strictEqual(actual, expected);

				var results = eventArgs[0];
				checkResults(results, {
					'symlink': 'symlink'
				});
			});
		});
	});
});
