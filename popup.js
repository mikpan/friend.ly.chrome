// Copyright (c) 2013 Mikhail Panshenskov. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Run our history script as soon as the document's DOM is ready.
document.addEventListener('DOMContentLoaded', function () {
	// oneall script to perform user login
    oneall.api.plugins.social_login.build("social_login_container", {
	  'providers' :  ['mailru'], 
	  'grid_size_x': '1',
	  'grid_size_y': '1',
	  'callback_uri': 'http://149.210.145.186:3000/users/auth'
    });
});