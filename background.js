// Copyright (c) 2013 Mikhail Panshenskov. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

/**
 * Global variables containing the query we'd like to pass to!
 *
 * @type {string}
 */
var HOST = "https://friendly-chart.herokuapp.com";
//var HOST = "http://localhost:3000";
var HISTORY_UPDATE_ADDRESS = HOST + "/history/";
var HISTORY_LAST_UPDATE_STAMP = HOST + "/history/latest/";
var LOGS_UPDATE_URL = HOST + "/logs/";
var LOCAL_ID = localStorage.localId;
var OLD_CHROME_VERSION = !chrome.runtime;
var LOG_LEVEL = 'ERROR';
var POLL_INTERVAL = 0.1;

Object.prototype.getName = function () {
    var funcNameRegex = /function (.{1,})\(/;
    var results = (funcNameRegex).exec((this).constructor.toString());
    return (results && results.length > 1) ? results[1] : "";
};

String.prototype.hashCode = function() {
    var hash = 0, i, chr, len;
    if (this.length == 0) return hash;
    for (i = 0, len = this.length; i < len; i++) {
        chr   = this.charCodeAt(i);
        hash  = ((hash << 5) - hash) + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
};

var historyUpdater = new function () {
    var historyItems = [];
    var lastHistoryItemStamp = 0;
    var running = false;
    var STAMP_MATCHER = new RegExp("[0-9]+[.]*[0-9]*");

    function getNextStamp() {
        var nextStamp, stamp = lastHistoryItemStamp;
        if (stamp.getName() == "Number")
            nextStamp = stamp + 0.001;
        else
            nextStamp = (stamp.indexOf(".") != -1) ? (stamp + "01") : (stamp + ".01");
        logger.debug("<--getNextStamp <-- " + nextStamp);
        return nextStamp;
    }

    function updateLastHistoryItemStamp(onSuccess) {
        logger.trace("-->updateLastHistoryItemStamp. " + getContextString());
        requestAsync(HISTORY_LAST_UPDATE_STAMP + LOCAL_ID,
            function (responseString) {
                logger.trace("-->response (" + responseString + ")");
                var stamp = 0;
                if (!responseString || responseString.match(STAMP_MATCHER).length == 0) {
                    logger.trace("The response does not contain time stamp format is incorrect: '" + responseString + "'");
                    return;
                } else {
                    var match = responseString.match(STAMP_MATCHER)[0];
                    stamp = parseFloat(match);
                }
                logger.trace("Updating time stamp: " + stamp);
                lastHistoryItemStamp = stamp;
                onSuccess();
            },
            function (error) {
                lastHistoryItemStamp = 0;
                logger.warn("Could not retrieve last update stamp for '"+ LOCAL_ID +"' client: " + error);
            }
        );
    }

    function getContextString() {
        return "LocalHistory" + (running ? "[running]" : "[completed]") + ": " + (historyItems ? historyItems.length : 0) + " items. Last stamp: " + lastHistoryItemStamp + ".";
    }

    return {
        tryCall: function (callee, args) {
            try {
                callee.call(this, args);
            } catch (exception) {
                logger.error(exception);
                running = false;
                throw exception;
            }
        },

        updateLocalId_Phase0: function () {
            if (LOCAL_ID && localStorage.localId) {
                historyUpdater.tryCall(historyUpdater.updateLatestTimestamp_Phase1);
                return;
            }

            var updateId = function (platInfo) {
                localStorage.localId = getUniqueId();
                LOCAL_ID = localStorage.localId;
                logger.warn("Generating new user id: " + LOCAL_ID);
                historyUpdater.tryCall(historyUpdater.updateLatestTimestamp_Phase1);
            };
            if (chrome.runtime.getPlatformInfo) {
                chrome.runtime.getPlatformInfo(function (platInfo) {
                    updateId(platInfo);
                });
            } else {
                updateId(null);
            }
        },


        updateLatestTimestamp_Phase1: function () {
            logger.trace("-->updateRecentHistorySinceLastPush." + getContextString());
            if (historyItems.length == 0) {
                lastHistoryItemStamp = 0;
            }
            if (lastHistoryItemStamp == 0) {
                var nextPhase = function() { historyUpdater.tryCall(historyUpdater.fetchLocalHistory_Phase2); };
                updateLastHistoryItemStamp(nextPhase); //get server recent history stamp && move on
            } else {
                historyUpdater.tryCall(historyUpdater.fetchLocalHistory_Phase2());
            }
        },

        fetchLocalHistory_Phase2: function () {
            var query = {'text': '', 'startTime': getNextStamp()};
            logger.debug("<--updateRecentHistorySinceLastPush." + getContextString());
            chrome.history.search(query, function(results) { historyUpdater.tryCall(historyUpdater.updateLocalHistory_Phase3, results); });
        },
        
        updateLocalHistory_Phase3: function (results) {
            var resultsCount = ((results && results.length) ? results.length : 0);
            logger.trace("-->chrome.history.search. Results.length=" + resultsCount + ". " + getContextString());
            if (resultsCount > 0)
                logger.trace("Found " + results.length + " history item(s).");
            else
                logger.trace("No history items found.");

            var item, imported = 0, localHistoryItemStamp = lastHistoryItemStamp;
            for (var i = 0; i < resultsCount; i++) {
                //make sure not to include the last pushed history items two times
                item = results[i];
                if (item.lastVisitTime == lastHistoryItemStamp)
                    continue;
                if (item.lastVisitTime > localHistoryItemStamp)
                    localHistoryItemStamp = item.lastVisitTime;

                imported++;
                historyItems.push(
                    {
                        'id': item.id,
                        'title': item.title,
                        'chromeId': LOCAL_ID,
                        'url': item.url,
                        'stamp': item.lastVisitTime
                    });
            }
            lastHistoryItemStamp = localHistoryItemStamp;
            logger.trace("Imported locally " + imported + " history items. Last history item re-stamped at: " + lastHistoryItemStamp);

            historyUpdater.tryCall(historyUpdater.postLocalHistory_Phase4);
            logger.trace("<--chrome.history.search. Results.length=" + resultsCount + ". " + getContextString());
        },

        postLocalHistory_Phase4: function () {
            logger.trace("-->postLocalHistory_Phase4." + getContextString());
            logger.trace("Post " + historyItems.length + " history items.");
            if (historyItems.length == 0) {
                running = false;
                logger.trace("<--postLocalHistory_Phase4." + getContextString());
                return; //nothing to push to the server
            }

            //push history to the server
            var postHistoryItems = historyItems.splice(0);
            postAsync(JSON.stringify(postHistoryItems),
                HISTORY_UPDATE_ADDRESS,
                function () {
                    logger.trace("-->postSusccess." + getContextString());
                    logger.info("Pushed successfully " + postHistoryItems.length + " history items");
                    running = false;
                    logger.trace("<--postSusccess." + getContextString());
                }, //empty history on successful push operation
                function () {
                    logger.trace("-->postFailed." + getContextString());
                    logger.error("Error when pushing the recent history. Restoring local history.");
                    historyItems = historyItems.concat(postHistoryItems);
                    running = false;
                    logger.trace("<--postFailed." + getContextString());
                });
        },

        run: function () {
            logger.debug("-->run. " + getContextString());

            if (running) {
                logger.trace("HistoryUpdater is still running. Exit.");
                return;
            }
            running = true;
            historyUpdater.tryCall(historyUpdater.updateLocalId_Phase0);

            logger.debug("<--run. " + getContextString());
        }
    }
};

var logger = new function () {
    var logLevel = LOG_LEVEL.toLowerCase();

    {
        switch (logLevel) {
            case 'error' :
            case 'warn'  :
            case 'info'  :
            case 'debug' :
            case 'trace' :
                break;
            default :
                log('error', 'Global log level not defined:' + logLevel);
        }
    }

    function isValid(msgLevel) {
        switch (logLevel) {
            case 'error' :
                return msgLevel === 'error';
            case 'warn'  :
                return msgLevel === 'error' || msgLevel === 'warn';
            case 'info'  :
                return msgLevel === 'error' || msgLevel === 'warn' || msgLevel == 'info';
            case 'debug' :
                return msgLevel === 'error' || msgLevel === 'warn' || msgLevel == 'info' || msgLevel == 'debug';
            case 'trace' :
                return msgLevel === 'error' || msgLevel === 'warn' || msgLevel == 'info' || msgLevel == 'debug' || msgLevel == 'trace';
        }
    }

    function log(msgLevel, message) {
        if (!isValid(msgLevel)) {
            return;
        }

        if (!localStorage.logs || localStorage.logs.length==0) {
            localStorage.logs = "[]";
        }
        var newMessage = (JSON.stringify({'level' : msgLevel, 'message' : message}));
        localStorage.logs = localStorage.logs.replace(/}]$/, "},]").replace(/]$/, newMessage + "]");

        switch (msgLevel) {
            case 'error' :
                console.error(message);
                break;
            case 'warn'  :
                console.warn(message);
                break;
            case 'info'  :
                console.info(message);
                break;
            case 'debug' :
                console.debug(message);
                break;
            case 'trace' :
                console.trace(message);
                break;
            default :
                log('error', 'Message log level not defined:' + msgLevel);
        }
    }

    return {

        error: function (text) {
            log('error', text);
        },
        warn: function (text) {
            log('warn', text);
        },
        info: function (text) {
            log('info', text);
        },
        debug: function (text) {
            log('debug', text);
        },
        trace: function (text) {
            log('trace', text);
        },

        flush: function () {
            if (localStorage.logs && localStorage.logs.length > 0)
                postAsync(JSON.stringify({browserId:LOCAL_ID,  logs:JSON.parse(localStorage.logs)}), LOGS_UPDATE_URL);
            localStorage.logs = "[]";
        }
    }
};

logger.flush();

function getUniqueId(platInfo) {
    return (platInfo && platInfo.os ? (platInfo.os + "-") : "") + chrome.runtime.id;
}

function requestAsync(toAddress, onSuccess, onError) {
    var xmlhttp = new XMLHttpRequest();   // new HttpRequest instance
    xmlhttp.open("GET", toAddress, true);
    xmlhttp.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
    xmlhttp.onreadystatechange = function (unused) {
        if (xmlhttp.status == 0 || xmlhttp.status == 200) {
            onSuccess(xmlhttp.responseText);
        } else {
            onError("xmlhttp.status: " + xmlhttp.status + ", xmlhttp.responseText: " + xmlhttp.responseText);
        }
    };
    xmlhttp.send("");
}

function postAsync(jsonRequest, toAddress, onSuccess, onFail) {
    var xmlhttp = new XMLHttpRequest();   // new HttpRequest instance
    xmlhttp.open("POST", toAddress, true);
    xmlhttp.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
    xmlhttp.onreadystatechange = function (unused) {
        if (xmlhttp.readyState == 4) {
            if (xmlhttp.status == 200) {
                logger.trace("Successful response: " + xmlhttp.responseText);
                if (onSuccess) onSuccess();
            }
            else {
                logger.error("Could not post to: " + toAddress + "\n");
                if (onFail) onFail();
            }
        }
    };
    xmlhttp.send(jsonRequest);
}

var callback = function(object) {
    console.info('===>' + JSON.stringify(object));
};

var handleInfoOnBeforeRequest = function(details) {
    console.info('===>' + JSON.stringify(details));
    chrome.tabs.get(details.tabId, callback);
};

function onInit() {
    logger.trace('onInit');
    chrome.alarms.get('historySync', function (alarm) {
        if (alarm) {
            chrome.alarms.create('historySync', {when: Date.now(), periodInMinutes: POLL_INTERVAL});
            logger.trace('History sync alarm exists. Yay.');
        } else {
            logger.trace('History sync alarm doesn\'t exist!? Syncing now and rescheduling.');
        }
        historyUpdater.run();
    });
    chrome.alarms.get('logFlush', function (alarm) {
        if (alarm) {
            chrome.alarms.create('logFlush', {when: Date.now(), periodInMinutes: POLL_INTERVAL});
        }
        logger.flush();
    });
    //chrome.webNavigation.onCompleted.addListener(handleOnBeforeRequest);
    //chrome.webNavigation.onBeforeNavigate.addListener(handleInfoOnBeforeRequest);
}

function onStartup() {
    logger.flush();
    logger.trace('onStartup');
}


function onAlarm(alarm) {
    logger.trace('Got alarm', alarm);
    // |alarm| can be undefined because onAlarm also gets called from
    // window.setTimeout on old chrome versions.
    if (alarm && alarm.name == 'historySync') {
        historyUpdater.run();
    } else if (alarm && alarm.name == 'logFlush') {
        logger.flush();
    } else {
        onInit();
    }
}

if (OLD_CHROME_VERSION) {
    logger.error("This Chrome API is not supported!");
} else {
    logger.trace("Set alarms.");
    onInit();
    chrome.runtime.onInstalled.addListener(onInit);
    chrome.runtime.onStartup.addListener(onInit);
    chrome.runtime.onStartup.addListener(onStartup);
    chrome.alarms.onAlarm.addListener(onAlarm);
// TODO: use the following to detect change
//    chrome.webNavigation.onBeforeNavigate.addListener(
//          function(details) {
//        console.log(details);
//  });
}

logger.info("Loaded. Local id: " + LOCAL_ID + ". Host:" + HOST);