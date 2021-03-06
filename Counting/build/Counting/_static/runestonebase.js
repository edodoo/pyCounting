/**
 * Runestone Base Class
 * All runestone components should inherit from RunestoneBase
 *
 * In addition all runestone components should do the following things:
 * 1. Ensure that they are wrapped in a div with the class runestone
 * 2. Write their source AND their generated html to the database if the database is configured
 * 3. properly save and restore their answers using the checkServer mechanism in this base class.
 *    Each component must provide an implementation of
 *    - checkLocalStorage
 *    - setLocalStorage
 *    - restoreAnswers
 *      disableInteraction
 *
 * 4. provide a Selenium based unit test
 *
 **/

import { pageProgressTracker } from "./bookfuncs.js";
//import "./../styles/runestone-custom-sphinx-bootstrap.css";

export default class RunestoneBase {
    constructor(opts) {
        this.optional = false;
        if (opts) {
            this.sid = opts.sid;
            this.graderactive = opts.graderactive;
            this.showfeedback = true;
            if (opts.timed) {
                this.isTimed = true;
            }
            if (opts.enforceDeadline) {
                this.deadline = opts.deadline;
            }
            if ($(opts.orig).data("optional")) {
                this.optional = true;
            } else {
                this.optional = false;
            }
            if (opts.selector_id) {
                this.selector_id = opts.selector_id;
            }
            if (typeof opts.assessmentTaken !== "undefined") {
                this.assessmentTaken = opts.assessmentTaken;
            } else {
                // default to true as this opt is only provided from a timedAssessment
                this.assessmentTaken = true;
            }
            if (typeof opts.timedWrapper !== "undefined") {
                this.timedWrapper = opts.timedWrapper;
            } else {
                this.timedWrapper = null;
            }
            if ($(opts.orig).data("question_label")) {
                this.question_label = $(opts.orig).data("question_label");
            }
        }
    }

    async logBookEvent(eventInfo) {
        if (this.graderactive) {
            return;
        }
        let post_return = Promise.resolve();
        eventInfo.course = eBookConfig.course;
        eventInfo.clientLoginStatus = eBookConfig.isLoggedIn;
        eventInfo.timezoneoffset = new Date().getTimezoneOffset() / 60;
        if (this.percent) {
            eventInfo.percent = this.percent;
        }
        if (eBookConfig.useRunestoneServices && eBookConfig.logLevel > 0) {
            let headers = new Headers({
                "Content-type": "application/json; charset=utf-8",
                Accept: "application/json",
            });
            let request = new Request(eBookConfig.ajaxURL + "hsblog", {
                method: "POST",
                headers: headers,
                body: JSON.stringify(eventInfo),
            });
            post_return = await fetch(request);
            if (!post_return.ok) {
                throw new Error("Failed to save the log entry");
            }
        }
        console.log("logging event " + JSON.stringify(eventInfo));
        if (
            typeof pageProgressTracker.updateProgress === "function" &&
            eventInfo.act != "edit" &&
            this.optional == false
        ) {
            pageProgressTracker.updateProgress(eventInfo.div_id);
        }
        return post_return;
    }
    async logRunEvent(eventInfo) {
        let post_promise = Promise.resolve("done");
        if (this.graderactive) {
            return;
        }
        eventInfo.course = eBookConfig.course;
        eventInfo.clientLoginStatus = eBookConfig.isLoggedIn;
        eventInfo.timezoneoffset = new Date().getTimezoneOffset() / 60;
        if (this.forceSave || "to_save" in eventInfo === false) {
            eventInfo.save_code = "True";
        }
        if (eBookConfig.useRunestoneServices && eBookConfig.logLevel > 0) {
            let headers = new Headers({
                "Content-type": "application/json; charset=utf-8",
                Accept: "application/json",
            });
            let request = new Request(eBookConfig.ajaxURL + "runlog.json", {
                method: "POST",
                headers: headers,
                body: JSON.stringify(eventInfo),
            });
            post_promise = await fetch(request);
            post_promise = await fetch(request);
            if (!post_promise.ok) {
                throw new Error("Failed to log the run");
            }
        }
        console.log("running " + JSON.stringify(eventInfo));
        if (
            typeof pageProgressTracker.updateProgress === "function" &&
            this.optional == false
        ) {
            pageProgressTracker.updateProgress(eventInfo.div_id);
        }
        return post_promise;
    }
    /* Checking/loading from storage */
    async checkServer(eventInfo) {
        // Check if the server has stored answer
        if (this.useRunestoneServices || this.graderactive) {
            let data = {};
            data.div_id = this.divid;
            data.course = eBookConfig.course;
            data.event = eventInfo;
            if (this.graderactive && this.deadline) {
                data.deadline = this.deadline;
                data.rawdeadline = this.rawdeadline;
                data.tzoff = this.tzoff;
            }
            if (this.sid) {
                data.sid = this.sid;
            }
            if (!eBookConfig.practice_mode && this.assessmentTaken) {
                jQuery
                    .getJSON(
                        eBookConfig.ajaxURL + "getAssessResults",
                        data,
                        // defined in in RunestoneBase
                        this.repopulateFromStorage.bind(this)
                    )
                    .fail(
                        function () {
                            try {
                                this.checkLocalStorage();
                            } catch (err) {
                                console.log(err);
                            }
                        }.bind(this)
                    );
            } else {
                this.loadData({});
            }
        } else {
            this.checkLocalStorage(); // just go right to local storage
        }
    }
    loadData(data) {
        // for most classes, loadData doesn't do anything. But for Parsons, and perhaps others in the future,
        // initialization can happen even when there's no history to be loaded
        return null;
    }

    /**
     * repopulateFromStorage is called after a successful API call is made to ``getAssessResults`` in
     * the checkServer method in this class
     *
     * ``restoreAnswers,`` ``setLocalStorage`` and ``checkLocalStorage`` are defined in the child classes.
     *
     * @param {*} data - a JSON object representing the data needed to restore a previous answer for a component
     * @param {*} status - the http status
     * @param {*} whatever - ignored
     */
    repopulateFromStorage(data, status, whatever) {
        // decide whether to use the server's answer (if there is one) or to load from storage
        if (data !== null && this.shouldUseServer(data)) {
            this.restoreAnswers(data);
            this.setLocalStorage(data);
        } else {
            this.checkLocalStorage();
        }
    }
    shouldUseServer(data) {
        // returns true if server data is more recent than local storage or if server storage is correct
        if (
            data.correct === "T" ||
            localStorage.length === 0 ||
            this.graderactive === true ||
            this.isTimed
        ) {
            return true;
        }
        let ex = localStorage.getItem(this.localStorageKey());
        if (ex === null) {
            return true;
        }
        let storedData;
        try {
            storedData = JSON.parse(ex);
        } catch (err) {
            // error while parsing; likely due to bad value stored in storage
            console.log(err.message);
            localStorage.removeItem(this.localStorageKey());
            // definitely don't want to use local storage here
            return true;
        }
        if (data.answer == storedData.answer) return true;
        let storageDate = new Date(storedData.timestamp);
        let serverDate = new Date(data.timestamp);
        return serverDate >= storageDate;
    }
    // Return the key which to be used when accessing local storage.
    localStorageKey() {
        return (
            eBookConfig.email +
            ":" +
            eBookConfig.course +
            ":" +
            this.divid +
            "-given"
        );
    }
    addCaption(elType) {
        //someElement.parentNode.insertBefore(newElement, someElement.nextSibling);
        if (!this.isTimed) {
            var capDiv = document.createElement("p");
            if (this.question_label) {
                this.caption = `Activity: ${this.question_label} ${this.caption}  <span class="runestone_caption_divid">(${this.divid})</span>`;
                $(capDiv).html(this.caption);
                $(capDiv).addClass(`${elType}_caption`);
            } else {
                $(capDiv).html(this.caption + " (" + this.divid + ")");
                $(capDiv).addClass(`${elType}_caption`);
                $(capDiv).addClass(`${elType}_caption_text`);
            }
            this.capDiv = capDiv;
            //this.outerDiv.parentNode.insertBefore(capDiv, this.outerDiv.nextSibling);
            this.containerDiv.appendChild(capDiv);
        }
    }

    hasUserActivity() {
        return this.isAnswered;
    }

    checkCurrentAnswer() {
        console.log(
            "Each component should provide an implementation of checkCurrentAnswer"
        );
    }

    async logCurrentAnswer() {
        console.log(
            "Each component should provide an implementation of logCurrentAnswer"
        );
    }
    renderFeedback() {
        console.log(
            "Each component should provide an implementation of renderFeedback"
        );
    }
    disableInteraction() {
        console.log(
            "Each component should provide an implementation of disableInteraction"
        );
    }
}

window.RunestoneBase = RunestoneBase;
