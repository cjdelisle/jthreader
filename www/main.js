$(function () {

    var escapeXML = function (data) {
        return data.replace(/[<&]/g, function (char) {
            switch (char) {
                case '<': return '&lt;'
                case '&': return '&amp;'
                default: throw new Error();
            }
        });
    };

    var pre = function (string) {
        return '<pre>' + string + '</pre>';
    };

    var currentPage = $('#nojs');
    var show =  function (page) {
        currentPage.attr('style', 'display:none');
        currentPage = $(page);
        currentPage.attr('style', '');
    };

    var walkSubmenus = function () {
        $('#result .jta-menuheader').each(function (i, elem) {
            $(elem).click(function () {
                var sm = $($(elem.parentNode).find('.jta-submenu')[0]);
                sm.toggleClass('jta-hidden');
                var pm = sm.hasClass('jta-hidden') ? '+' : '-';
                $(elem).text($(elem).text().replace(/^\[[+-]\]/, '[' + pm + ']'));
            });
        });
    };

    var pageTwo = function () {
        show('#pagetwo');
        var path = window.location.href.replace(/.*#!\//, '');
        var id = path.replace(/^.*\/|\.txt$/g, '');
        var reqType = path.replace(/\/.*$/, '');
        $.ajax({
            url: '/input/' + id + '.txt',
            method: 'GET',
            success: function (ret) {
                var result;
                if (reqType === 'raw') {
                    var analysisURL = window.location.href.replace(/\/#!\/raw\//, '/#!/analysis/');
                    result = 'JThreader raw stack trace, see: <a href="' + analysisURL +'">' +
                        analysisURL + '</a> for JThreader\'s analysis.<br><br>';
                    result += pre(escapeXML(ret));
                } else {
                    var rawURL = window.location.href.replace(/\/#!\/[^\/]*\//, '/#!/raw/');
                    result = 'JThreader stack trace analysis, see: <a href="' + rawURL + '">' +
                        rawURL + '</a> for the raw thread dump<br><br>';
                    try {
                        result += JThreader.processDumpB(ret);
                    } catch (e) {
                        result += "<strong>Parser Error:</strong> The log appears to be incomplete or " +
                            "damaged, try reading the raw form of the thread dump instead.<br><br>" +
                            pre(escapeXML("Cause: " + e.message + "\n" + e.stack));
                    }
                }
                $('#result').html(result);
                walkSubmenus();
                $('#result a').each(function (i, a) {
                    $(a).click(function () {
                        setTimeout(pageTwo)
                    });
                });
            }
        });
    };

    var pageOne = function () {
        show('#pageone');
        $('#explain-it').on('click', function (evt) {
            evt.preventDefault();
            var content = $('#content').val();
            $.ajax({
                url: '/api/1/explain',
                method: 'POST',
                processData: false,
                data: content,
                success: function (ret) {
                    window.location.href = ret;
                    pageTwo(ret);
                }
            });
        });
    };

    if (window.location.href.indexOf('#') !== -1) {
        pageTwo();
    } else {
        pageOne();
    }
});
