$(function () {
    var currentPage = $('#nojs');
    var show =  function (page) {
        currentPage.attr('style', 'display:none');
        currentPage = $(page);
        currentPage.attr('style', '');
    };

    var pageTwo = function () {
        show('#pagetwo');
        var path = window.location.href.replace(/.*#!/, '');
        $.ajax({
            url: path,
            method: 'GET',
            success: function (ret) { $('#result').text(ret); }
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
