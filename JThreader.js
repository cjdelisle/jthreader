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

if (module.parent === null) {
    process.stdin.resume();
    var data = '';
    process.stdin.on('data', function(chunk) {
        data += chunk.toString('utf8');
    });
    process.stdin.on('end', function() {
        console.log(processDump(data));
    });
}
