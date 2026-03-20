# Admin Panel Implementation TODO

## [ ] 1. Update Dependencies
- [ ] Edit package.json: Add bcrypt, jsonwebtoken, express-session, cookie-parser
- [ ] Run `npm install`

## [ ] 2. Backend Updates (server.js)
- [ ] Add imports & middleware (session, bcrypt, jwt, cookie-parser)
- [ ] Create admins.json handling
- [ ] Add admin auth guard
- [ ] Implement admin routes: /admin/login, /admin/register, /admin/sessions, DELETE /admin/session/:code, DELETE /admin/file/:sessionId/:filename
- [ ] Serve admin.html at /admin/*

## [ ] 3. Create Admin Files
- [ ] admins.json (initial structure)
- [ ] admin.html (login/register + dashboard)
- [ ] js/admin.js (auth & CRUD logic)

## [ ] 4. Testing
- [ ] Test register/login
- [ ] Test session/file delete
- [ ] Verify security (non-admin access denied)
- [ ] UI matches cyberpunk theme

## [ ] 5. Demo
- Run `npm start`
- Access http://localhost:3000/admin
