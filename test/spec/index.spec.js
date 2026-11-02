'use strict';

var test = require('node:test');
var assert = require('node:assert');

test.describe('recursive-copy', function() {
	test.it('Should export a function', function() {
		assert.strictEqual(typeof require('../..'), 'function');
	});
});
