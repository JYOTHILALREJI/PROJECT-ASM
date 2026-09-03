#!/bin/bash
# Task 9 UI verification — Documents upgrades
set -x
AB="agent-browser"

$AB set viewport 1500 900
$AB open http://localhost:3000/
sleep 3
$AB snapshot 2>/dev/null | head -40
