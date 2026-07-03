echo building backend application
pushd backend
pyinstaller --noconfirm app.spec
popd

echo building frontend application
pushd frontend
call npm run build
popd

echo creating distribution package
call npm run dist
pause