/* vim: set expandtab ts=4 sw=4: */
/*
 * You may redistribute this program and/or modify it under the terms of
 * the GNU General Public License as published by the Free Software Foundation,
 * either version 3 of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
;(function () {

if (typeof(module) === 'undefined' || !module.exports) {
    var module = { exports: {}, browser:1 };
}

var CLEAN_THREAD_NAME = /^"([^"]*).* (tid=[0-9a-fx]*) nid=[^ ]* ([^ ]*) .*$/;
var cleanThreadName = function (name) {
   return name.replace(CLEAN_THREAD_NAME, function (all, name, tid, state) {
       return name + ' - ' + tid + ' ' + state;
   });
};

var WAITING_FOR_LOCK = /- waiting to lock (<0x[0-9a-f]*> .*)$/;
var waitingForLock = function (line) {
    return (line.match(WAITING_FOR_LOCK) || [])[1];
};

var HOLDING_LOCK = /- locked (<0x[0-9a-f]*> .*)$/;
var holdingLock = function (line) {
    return (line.match(HOLDING_LOCK) || [])[1];
};

var THREAD_HEADER = /^"([^"]+)" (daemon )?prio=([0-9]+) tid=(0x[0-9a-f]+) nid=(0x[0-9a-f]+) (.*)$/;
var parseThreadHeader = function (thread, line) {
    var out = THREAD_HEADER.exec(line);
    if (!out) { throw new Error("[" + line + "] does not match thread header regex"); }
    thread.name = out[1];
    thread.daemon = (out[2] !== undefined);
    thread.priority = Number(out[3]);
    thread.tid = out[4];
    thread.nid = out[5];
    thread.state = out[6];
};

var STACK_FRAME = /^\sat ([^\(]+)\(([^\)]+)\)$/;
var parseFrame = function (line) {
    var parsed = STACK_FRAME.exec(line);
    if (!parsed) { throw new Error("Unparsible stack frame [" + line + "]"); }
    return {
        method: parsed[1],
        file: parsed[2]
    };
};

var parseThread = function (thread, lines, i) {
    thread.locksHeld = [];
    thread.rawLines = [];
    thread.blockedOn = null;
    parseThreadHeader(thread, lines[i++]);
    var frames = thread.frames = [];
    for (; i < lines.length && lines[i] !== ''; i++) {
        thread.rawLines.push(lines[i].replace(/^\s*/, ''));
        if (lines[i].indexOf('	at ') === 0) {
            frames.push(parseFrame(lines[i]));
        } else {
            var holding = holdingLock(lines[i]);
            if (holding) {
                thread.locksHeld.push(holding);
                continue;
            }
            var blockedOn = waitingForLock(lines[i]);
            if (blockedOn) {
                thread.blockedOn = blockedOn;
            }
        }
    }
    if (i === lines.length) { throw new Error("thread section not terminated by empty line"); }
    i++;
    return i;
};

var error = function (lines, i) {
    throw new Error("Failed to parse line number [" + i + "], with content [" + lines[i] + "]");
};

var PS_GENERATION =
    /^\s(PSYoungGen|PSOldGen|PSPermGen)\s+total ([0-9]+)K, used ([0-9]+)K \[([a-f0-9,x ]+)\)$/;
var EDEN_FROM_TO = /\s+(eden|from|to) +space ([0-9]+)K, ([0-9]+)% used \[([a-f0-9, x ]+)\)$/;
var OBJECT_SPACE = /\s+object space ([0-9]+)K, ([0-9]+)% used \[([a-f0-9, x ]+)\)$/;
var parseHeap = function (out, lines, i) {
    if (lines[i++] !== 'Heap') { throw new Error(); }

    out.PSYoungGen = {
        total: 0,
        eden: 0,
        from: 0,
        to: 0,
    };
    out.PSOldGen = {
        total: 0,
    };
    out.PSPermGen = {
        total: 0
    };

    var youngGen = PS_GENERATION.exec(lines[i++]) || error(lines, i-1);
    out.PSYoungGen.total = Number(youngGen[3]) / Number(youngGen[2]);

    var eden = EDEN_FROM_TO.exec(lines[i++]) || error(lines, i-1);
    out.PSYoungGen.eden = Number(eden[3]);

    var from = EDEN_FROM_TO.exec(lines[i++]) || error(lines, i-1);
    out.PSYoungGen.eden = Number(from[3]);

    var to = EDEN_FROM_TO.exec(lines[i++]) || error(lines, i-1);
    out.PSYoungGen.to = Number(to[3]);


    var oldGen = PS_GENERATION.exec(lines[i++]) || error(lines, i-1);
    out.PSOldGen.total = Number(oldGen[3]) / Number(oldGen[2]);
    OBJECT_SPACE.exec(lines[i++]) || error(lines, i-1);

    var permGen = PS_GENERATION.exec(lines[i++]) || error(lines, i-1);
    out.PSPermGen.total = Number(permGen[3]) / Number(permGen[2]);
    OBJECT_SPACE.exec(lines[i++]) || error(lines, i-1);

    return i;
};

var parseDump = function (lines) {
    var i = 0;
    for (; i < lines.length && !(/^Full thread dump/.test(lines[i++])); ) ;
    if (i === lines.length || lines[i] !== '') {
        throw new Error(
            "A thread dump must begin with \"Full thread dump\" followed by an empty line");
    }
    i++;
    var out = {
        threads: [],
        jniGlobalReferences: -1,
        warnings: []
    };
    while (i < lines.length) {
        if (lines[i][0] === '"') {
            var thread = {};
            out.threads.push(thread);
            i = parseThread(thread, lines, i);
        } else if (lines[i].indexOf('JNI global references: ') === 0) {
            var jgl = /^JNI global references: ([0-9]+)$/.exec(lines[i]);
            if (!jgl) { throw new Error("Invalid global references: [" + lines[i] + "]"); }
            out.jniGlobalReferences = Number(jgl[1]);
            i++;
        } else if (lines[i] === 'Heap') {
            i = parseHeap(out, lines, i);
            if (i+1 !== lines.length) {
                out.warnings.push("trailing crap: [" + lines.slice(i).join('\n') + "]");
                i = lines.length;
            }
        } else if (lines[i] !== '') {
            error(lines, i);
        } else {
            i++;
        }
    }

    if (!out.PSOldGen) {
        throw new Error("This thread dump appears to be missing the memory usage information " +
            "which should be found at the bottom.");
    }

    return out;
};

var submenu = function (out, header, func, expanded) {
    var INITIAL_HEADER_DEPTH = 2;
    var headerDepth = (out.headerDepth || INITIAL_HEADER_DEPTH);
    out.headerDepth = headerDepth + 1;
//expanded=true;
    var pm = ((expanded) ? '-' : '+');
    var eh = ((expanded) ? '' : 'jta-hidden ');
    out.push("");
    out.push('<div class="jta-expandable">');
    out.push('<h' + headerDepth + ' class="jta-menuheader">[' + pm + '] ' + header + '</h' + headerDepth + '>');
    out.push('<div class="' + eh + 'jta-submenu">');
    func();
    out.push("</div>");
    out.push("</div>");
    out.push("");
    out.headerDepth--;
};

var escapeXML = function (data) {
    return data.replace(/[<&]/g, function (char) {
        switch (char) {
            case '<': return '&lt;'
            case '&': return '&amp;'
            default: throw new Error();
        }
    });
};

var printFrame = function (out, frame) {
    out.push(escapeXML(frame.method + "(" + frame.file + ")"));
};

var printThread = function (out, thread, expanded) {
    submenu(out, thread.name, function () {
        out.push('<pre>');
        for (var i = 0; i < thread.rawLines.length; i++) {
            out.push(thread.rawLines[i]);
        }
        out.push('</pre>');
    }, expanded);
};

var printThreads = function (out, threads, expanded) {
    for (var i = 0; i < threads.length; i++) {
        printThread(out, threads[i], expanded);
    }
};

var warning = function (text) {
    return '<div class="jta-warning"><strong>WARNING</strong>: ' + text + '</div>';
};

var INTERNAL_THREADS = /^(VM Thread|GC task thread.*|Low Memory Detector)$/;

var processDumpB = module.exports.processDumpB = function (threadDump) {
    var dump;
    try {
        dump = parseDump(threadDump.split('\n'));
    } catch (e) {
        return 'Error:\n' + e.message + '\n\n' + e.stack;
    }

    var out = [];

    var runningThreads = [];
    var internalThreads = [];
    var blockedThreads = [];
    var parkedThreads = [];
    for (var i = 0; i < dump.threads.length; i++) {
        if (dump.threads[i].state.indexOf("runnable") !== -1) {
            if (INTERNAL_THREADS.test(dump.threads[i].name)) {
                internalThreads.push(dump.threads[i]);
            } else {
                runningThreads.push(dump.threads[i]);
            }
        } else if (dump.threads[i].blockedOn) {
            blockedThreads.push(dump.threads[i]);
        } else {
            parkedThreads.push(dump.threads[i]);
        }
    }

    if (dump.PSPermGen.total > 0.9) {
        out.push(warning("PermGen space is " + Math.floor(dump.PSPermGen.total * 100) + "% " +
                 "full, consider changing -XX:PermGen in java flags"));
    }

    if (dump.PSOldGen.total > 0.9) {
        out.push(warning("Memory space is " + Math.floor(dump.PSOldGen.total * 100) + "% full " +
                 " consider changing -Xmx in java flags or check for a memory leak."));
    }


    out.push('');

    submenu(out, internalThreads.length + "\tInternal threads", function () {
        printThreads(out, internalThreads);
    });

    submenu(out, parkedThreads.length + "\tParked (intentionally stopped)", function () {
        printThreads(out, parkedThreads);
    });

    submenu(out, blockedThreads.length + "\tWaiting for lock", function () {
        printThreads(out, blockedThreads);
    }, true);

    var tpProcessorThreads = [];
    var nonTpProcessorThreads = [];
    for (var i = 0; i < runningThreads.length; i++) {
        if (runningThreads[i].name.indexOf('TP-Processor') === 0) {
            tpProcessorThreads.push(runningThreads[i]);
        } else {
            nonTpProcessorThreads.push(runningThreads[i]);
        }
    }

    submenu(out, runningThreads.length + "\tActive Threads", function () {
        if (tpProcessorThreads.length > 0) {
            submenu(out, tpProcessorThreads.length + "\tThread Pool Processors", function () {
                printThreads(out, tpProcessorThreads);
            });
        }
        printThreads(out, nonTpProcessorThreads, true);
    }, true);

    out.push('');

    return out.join('\n');
};

var processDump = module.exports.processDump = function (threadDump) {
    // an array of locks per thread
    var locksHeldByThread = {};

    // and array of threads waiting on each lock
    var threadsWaitingByLock = {};

    // one lock blocking the thread if any.
    var lockByThread = {};

    // one thread holding each lock if any.
    var threadByLock = {};

    var allThreads = [];

    var currentThread = '';
    var threadBlocked = false;
    var processLine = function (line) {
        if (line.indexOf(' tid=') > -1) {
            currentThread = cleanThreadName(line);
            threadBlocked = false;
            allThreads.push(currentThread);
            return;
        }
        var lock = waitingForLock(line);
        if (lock) {
            (threadsWaitingByLock[lock] = threadsWaitingByLock[lock] || []).push(currentThread);
            lockByThread[currentThread] = lock;
            threadBlocked = true;
        }
        lock = holdingLock(line);
        if (lock) {
            (locksHeldByThread[currentThread] = locksHeldByThread[currentThread] || []).push(lock);
            locksHeldByThread[currentThread].blocked = threadBlocked;
            threadByLock[lock] = currentThread;
        }
    };

    var assertNoDeadlock = function (thread, _stack, out) {
        if (!thread) { return; }
        var stack = [];
        stack.push.apply(stack, _stack);
        if (stack.indexOf(thread) > -1) {
            out.push("DEADLOCK DETECTED");
            stack.forEach(function (thr) {
                out.push('    ' + thr);
                out.push('        - waiting on ' + lockByThread[thr]);
                (locksHeldByThread[thr] || []).forEach(function (loc) {
                    out.push('        - locked     ' + loc);
                });
            });
            return 1;
        }
        stack.push(thread);
        (locksHeldByThread[thread] || []).forEach(function (thr) {
            assertNoDeadlock(thr, stack, out);
        });
    };

    var reportThreadStack = function (thread, out) {
        var lock = lockByThread[thread];
        out.push(thread);
        while (lock) {
            out.push("    - blocked by " + lock);
            thread = threadByLock[lock];
            if (!thread) {
                out.push("    ----- PHANTOM LOCK! -----");
                return;
            }
            out.push("    - held by " + thread);
            lock = lockByThread[thread];
        }
    };

    var complete = function () {
        var out = [];
        out.push("Live threads:");
        for (var i = 0; i < allThreads.length; i++) {
            var thread = allThreads[i];
            if (/runnable$/.test(thread)) { out.push(thread); }
        }
        out.push("\nParked Threads:");
        for (var i = 0; i < allThreads.length; i++) {
            var thread = allThreads[i];
            if (!(/runnable$/.test(thread)) && !lockByThread[thread]) { out.push(thread); }
        }
        out.push("\nBlocked Threads:")
        for (var i = 0; i < allThreads.length; i++) {
            var thread = allThreads[i];
            var lockHolding = lockByThread[thread];
            if (!lockHolding) {
                continue;
            }

            if (assertNoDeadlock(thread, [], out)) { return out; }

            var locksHeld = locksHeldByThread[thread] || [];
            for (var j = 0; j < locksHeld.length; j++) {
                if (typeof(threadsWaitingByLock[locksHeld[j]]) !== 'undefined') {
                    // skip this thread, we'll report it when we report the longer chain.
                    continue;
                }
            }

            reportThreadStack(thread, out);
            out.push();
        }
        return out;
    };

    threadDump.split('\n').forEach(processLine);
    return complete().join('\n');
};

var node = function () {
    if (module.parent === null) {
        process.stdin.resume();
        var data = '';
        process.stdin.on('data', function(chunk) {
            data += chunk.toString('utf8');
        });
        process.stdin.on('end', function() {
            //console.log(processDump(data));
            console.log(processDumpB(data));
            //console.log(JSON.stringify(parseDump(data.split('\n')), null, '  '));
        });
    }
};

if (!module.browser) {
    node();
} else if (typeof(window) !== 'undefined') {
    window.JThreader = module.exports;
}

}());
