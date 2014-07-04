#!/bin/bash

function usage {
    echo "Usage: $0 --post <username@sshserver>";
    exit 0;
}

function die {
    echo 'crap';
    exit 1;
}

[[ $2 == "" ]] && usage;
[[ $1 == "--post" ]] || usage;

DIR_NAME=`pwd | sed 's@.*/@@'` || die
tar -cjf - ./* \
    | ssh $2 "( mkdir ${DIR_NAME} 2>/dev/null || \
                find ./${DIR_NAME}/ -regex '^\./${DIR_NAME}/.+' -delete ) && \
              cd ${DIR_NAME} && \
              tar -xjf - && \
              echo 'success'" \
        || die
