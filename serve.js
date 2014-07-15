/*
 * Copyright 2014 XWiki SAS
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

var Static = require('node-static');
var Http = require('http');
var nThen = require('nthen');
var Fs = require('fs');

var PORT = 8099;
var WWWPATH = __dirname +'/www';
var DATAPATH = __dirname + '/../jthreader_data/';
var SERVERNAME = process.env.SERVERNAME || 'http://jthreader.xwiki.com/';

var uid = function () {
    return Math.random().toString(36).substring(2);
};

var upload = function (request, response) {
    var data = '';
    var id = uid();
    var abort = false;
    request.on('data', function (d) {
        if (data.length > 10000000) {
            response.writeHead(200, {"Content-Type": "text/plain"});
            response.end("Too much data.\n");
            abort = true;
        }
        data += d.toString('utf8');
    });
    nThen(function (waitFor) {
        if (abort) { waitFor.abort(); }
        request.on('end', waitFor());
    }).nThen(function (waitFor) {
        Fs.writeFile(DATAPATH + '/input/' + id + '.txt', data, waitFor(function (err) {
            if (err) { throw err; }
        }));
        var state = {
            headers: request.headers,
            url: request.url,
            remoteAddress: request.connection.remoteAddress,
            remotePort: request.connection.remotePort,
            now: (new Date()).getTime()
        };
        Fs.writeFile(DATAPATH + '/stats/' + id + '.json',
                     JSON.stringify(state),
                     waitFor(function (err) {
            if (err) { throw err; }
        }));
    }).nThen(function (waitFor) {
        response.writeHead(200, {"Content-Type": "text/plain"});
        response.end(SERVERNAME + "#!/analysis/" + id + "\n");
    });
};

var apiReq = function (request, response) {
    if (request.url === '/api/1/explain') { return upload(request, response); }
    response.writeHead(200, {"Content-Type": "text/plain"});
    response.end("I'm sorry, Dave. I'm afraid I can't do that.\n");
};

var mkdir = function (dirName, callback) {
    Fs.exists(dirName, function (exists) {
        if (exists) { callback(); return; }
        Fs.mkdir(dirName, function (err) {
            if (err) { throw err; }
            callback();
        });
    });
};

var startServer = function () {
    var file = new Static.Server(WWWPATH);
    var data = new Static.Server(DATAPATH);
    Http.createServer(function (request, response) {
        if (request.url.indexOf('/api/1/') === 0) { return apiReq(request, response); }
        if (request.url.indexOf('/input/') === 0) {
            request.addListener('end', function () {
                data.serve(request, response);
            }).resume();
            return;
        }
        request.addListener('end', function () {
            file.serve(request, response);
        });
        request.resume();
    }).listen(PORT);
};

var makeDirs = function (callback) {
    nThen(function (waitFor) {
        mkdir(DATAPATH, waitFor());
    }).nThen(function (waitFor) {
        mkdir(DATAPATH + '/input/', waitFor());
        mkdir(DATAPATH + '/stats/', waitFor());
    }).nThen(callback);
};

var main = function () {
    nThen(function (waitFor) {
        makeDirs(waitFor());
    }).nThen(function (waitFor) {
        startServer();
    });
};
main();
