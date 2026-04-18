#!/bin/bash
DATABASE_URL="$(node -e "console.log(require('./config.json').db.url)")" yarn prisma:push
