/**
 * BzDeck Application Logic
 * Copyright © 2014 Kohei Yoshino. All rights reserved.
 */

'use strict';

let BzDeck = BzDeck || {};

/* ----------------------------------------------------------------------------------------------
 * Bootstrap
 * ---------------------------------------------------------------------------------------------- */

BzDeck.bootstrap = {};

BzDeck.bootstrap.start = function () {
  let status = message => BzDeck.core.show_status(message);

  this.$form = document.querySelector('#app-login form');
  this.$input = this.$form.querySelector('[role="textbox"]');
  this.$button = this.$form.querySelector('[role="button"]');
  BzDeck.core.$statusbar = document.querySelector('#app-login [role="status"]');

  // Delete the old DB
  indexedDB.deleteDatabase('BzDeck');

  BzDeck.model.open_global_database().then(database => {
    BzDeck.model.databases.global = database;
  }, error => {
    status(error.message);
  }).then(() => {
    return BzDeck.model.get_active_account();
  }).then(account => {
    BzDeck.model.data.account = account;
  }).then(() => {
    return BzDeck.model.get_server(BzDeck.model.data.account.host);
  }).then(server => {
    BzDeck.model.data.server = server;
  }).catch(() => {
    status('');

    return new Promise((resolve, reject) => {
      this.show_login_form().then(() => {
        // TODO: Users will be able to choose an instance on the sign-in form
        return BzDeck.model.get_server('mozilla');
      }).then(server => {
        BzDeck.model.data.server = server;
      }).then(() => {
        status('Verifying your account...'); // l10n

        return BzDeck.model.fetch_user(this.$input.value);
      }).then(account => {
        account.active = true;
        account.loaded = Date.now(); // key
        account.host = BzDeck.model.data.server.name;
        BzDeck.model.data.account = account;
        BzDeck.model.save_account(account);
        resolve();
      }).catch(error => {
        if (error.message === 'Network Error') {
          status('Failed to sign in. Network error?'); // l10n
        } else if (error.message === 'User Not Found') {
          status('Your account could not be found. Please check your email adress and try again.'); // l10n
        } else {
          status(error.message);
        }

        this.$input.disabled = this.$button.disabled = false;
      });
    });
  }).then(() => {
    return BzDeck.model.open_account_database();
  }).then(database => {
    BzDeck.model.databases.account = database;
  }, error => {
    status(error.message);
  }).then(() => {
    return BzDeck.model.load_prefs();
  }).then(() => {
    status('Loading bugs...'); // l10n
    document.querySelector('#app-intro').style.display = 'none';

    return Promise.all([
      BzDeck.model.fetch_subscriptions(),
      BzDeck.model.load_config().then(config => {
        BzDeck.model.data.server.config = config
      }, error => {
        this.$input.disabled = this.$button.disabled = true;
        status(error.message);
      })
    ]);
  }).then(() => {
    if (!this.relogin) {
      // Finally load the UI modules
      BzDeck.bootstrap.setup_ui();
    }
  }, error => {
    status(error.message);
  }).then(() => {
    this.show_notification();
    this.finish();
  });
};

BzDeck.bootstrap.show_login_form = function (firstrun = true) {
  this.$form.setAttribute('aria-hidden', 'false');
  this.$input.disabled = this.$button.disabled = false;
  this.$input.focus();

  if (!firstrun) {
    return true;
  }

  return new Promise((resolve, reject) => {
    this.$form.addEventListener('submit', event => {
      if (!this.processing) {
        // User is trying to re-login
        this.relogin = true;
        this.processing = true;
      }

      if (navigator.onLine) {
        this.$input.disabled = this.$button.disabled = true;
        resolve();
      } else {
        reject(new Error('You have to go online to sign in.')); // l10n
      }

      event.preventDefault();

      return false;
    });
  });
};

BzDeck.bootstrap.setup_ui = function () {
  BzDeck.core.show_status('Loading UI...'); // l10n

  let datetime = FlareTail.util.datetime,
      prefs = BzDeck.model.data.prefs,
      value,
      theme = prefs['ui.theme.selected'],
      FTut = FlareTail.util.theme,
      $root = document.documentElement;

  // Automatically update relative dates on the app
  datetime.options.updater_enabled = true;

  // Date format
  value = prefs['ui.date.relative'];
  datetime.options.relative = value !== undefined ? value : true;

  // Date timezone
  value = prefs['ui.date.timezone'];
  datetime.options.timezone = value || 'local';

  // Timeline: Font
  value = prefs['ui.timeline.font.family'];
  $root.setAttribute('data-timeline-font-family', value || 'proportional');

  // Timeline: Sort order
  value = prefs['ui.timeline.sort.order'];
  $root.setAttribute('data-timeline-sort-order', value || 'ascending');

  // Timeline: Changes
  value = prefs['ui.timeline.show_cc_changes'];
  $root.setAttribute('data-timeline-show-cc-changes', value !== undefined ? value : false);

  // Timeline: Attachments
  value = prefs['ui.timeline.display_attachments_inline'];
  $root.setAttribute('data-timeline-display-attachments-inline', value !== undefined ? value : true);

  // Activate widgets
  BzDeck.homepage = new BzDeck.HomePage();
  BzDeck.toolbar.setup();
  BzDeck.sidebar.setup();
  BzDeck.DetailsPage.swipe.init();

  // Check the requested URL to open the specific folder or tab if needed
  FlareTail.util.event.trigger(window, 'popstate');

  // Change the theme
  if (theme && FTut.list.contains(theme)) {
    FTut.selected = theme;
  }

  // Preload images from CSS
  FTut.preload_images();
};

BzDeck.bootstrap.show_notification = function () {
  // Authorize a notification
  FlareTail.util.app.auth_notification();

  // Update UI & Show a notification
  BzDeck.core.toggle_unread_ui(true);

  // Notify requests
  BzDeck.model.get_subscription_by_id('requests').then(bugs => {
    let len = bugs.size;

    if (!len) {
      return;
    }

    let title = len > 1 ? 'You have %d requests'.replace('%d', len)
                        : 'You have 1 request'; // l10n
    let body = len > 1 ? 'Select the Requests folder to browse those bugs.'
                       : 'Select the Requests folder to browse the bug.'; // l10n

    // TODO: Improve the notification body to describe more about the requests,
    // e.g. There are 2 bugs awaiting your information, 3 patches awaiting your review.

    BzDeck.core.show_notification(title, body).then(event => {
      // Select the Requests folder when the notification is clicked
      $root.setAttribute('data-current-tab', 'home');
      BzDeck.toolbar.tablist.view.selected = document.querySelector('#tab-home');
      BzDeck.sidebar.folders.view.selected = document.querySelector('#sidebar-folders--requests');
    });
  });
};

BzDeck.bootstrap.finish = function () {
  // Timer to check for updates
  BzDeck.core.timers.fetch_subscriptions = window.setInterval(() => {
    BzDeck.model.fetch_subscriptions();
  }, 600000); // Call every 10 minutes

  // Register the app for an activity on Firefox OS
  BzDeck.core.register_activity_handler();

  // Connect to the push notification server
  // BzDeck.bugzfeed.connect();

  BzDeck.core.show_status('Loading complete.'); // l10n
  BzDeck.session.login();
  this.processing = false;
};

/* ----------------------------------------------------------------------------------------------
 * Core
 * ---------------------------------------------------------------------------------------------- */

BzDeck.core = {};
BzDeck.core.timers = {};

BzDeck.core.toggle_star = function (id, starred) {
  // Save in DB
  BzDeck.model.get_bug_by_id(id).then(bug => {
    if (bug && bug.comments) {
      if (!bug._starred_comments) {
        bug._starred_comments = new Set();
      }

      if (starred) {
        bug._starred_comments.add(bug.comments[0].id);
      } else {
        bug._starred_comments.clear();
      }

      BzDeck.model.save_bug(bug);
      this.toggle_star_ui(bug);
    }
  });
};

BzDeck.core.toggle_star_ui = function (bug) {
  FlareTail.util.event.trigger(window, 'UI:toggle_star', { 'detail': { bug }});
};

BzDeck.core.toggle_unread = function (id, value) {
  // Save in DB
  BzDeck.model.get_bug_by_id(id).then(bug => {
    if (bug && bug._unread !== value) {
      bug._unread = value;
      BzDeck.model.save_bug(bug);
      this.toggle_unread_ui();
    }
  });
};

BzDeck.core.toggle_unread_ui = function (loaded = false) {
  BzDeck.model.get_all_bugs().then(bugs => {
    FlareTail.util.event.trigger(window, 'UI:toggle_unread', { 'detail': {
      loaded,
      'bugs': new Set([for (bug of bugs) if (bug._unread) bug]),
      'ids': new Set([for (bug of bugs) if (bug._unread) bug.id])
    }});
  });
};

BzDeck.core.install_app = function () {
  FlareTail.util.app.install(BzDeck.config.app.manifest).then(() => {
    document.querySelector('#main-menu--app--install').setAttribute('aria-disabled', 'true');
  });
};

BzDeck.core.show_status = function (message) {
  if (this.$statusbar) {
    this.$statusbar.textContent = message;
  }
};

BzDeck.core.show_notification = function (title, body) {
  if (BzDeck.model.data.prefs['notifications.show_desktop_notifications'] === false) {
    return;
  }

  let ua = navigator.userAgent,
      fxos = ua.contains('Firefox') && !ua.contains('Android') && ua.match(/Mobile|Tablet/);

  return new Promise((resolve, reject) => {
    FlareTail.util.app.show_notification(title, {
      body,
      // Firefox OS requires a complete URL for the icon
      'icon': `${location.origin}/static/images/logo/icon-${fxos ? 'fxos-120' : '128'}.png`
    }).then(event => resolve(event));
  });
};

BzDeck.core.register_activity_handler = function () {
  // Match BMO's bug detail pages.
  // TODO: Implement a handler for attachments
  let re = /^https?:\/\/(?:bugzilla\.mozilla\.org\/show_bug\.cgi\?id=|bugzil\.la\/)(\d+)$/;

  // Not implemented yet on Firefox OS nor Firefox for Android
  if (typeof navigator.mozRegisterActivityHandler === 'function') {
    navigator.mozRegisterActivityHandler({
      'name': 'view',
      'filters': {
        'type': 'url',
        'url': {
          'required': true,
          'regexp': re
        }
      }
    });
  }

  if (typeof navigator.mozSetMessageHandler === 'function') {
    navigator.mozSetMessageHandler('activity', req => {
      if (req.source.url.match(re)) {
        BzDeck.detailspage = new BzDeck.DetailsPage(Number.parseInt(RegExp.$1));
      }
    });
  }
};

BzDeck.core.parse_comment = function (str) {
  let blockquote = p => {
    let regex = /^&gt;\s?/gm;

    if (!p.match(regex)) {
      return p;
    }

    let lines = p.split(/\n/),
        quote = [];

    for (let [i, line] of lines.entries()) {
      if (line.match(regex)) {
        // A quote start
        quote.push(line);
      }

      if ((!line.match(regex) || !lines[i + 1]) && quote.length) {
        // A quote end, the next line is not a part of the quote, or no more lines
        let quote_str = quote.join('\n'),
            quote_repl = quote_str.replace(regex, '');

        if (quote_repl.match(regex)) {
          // Nested quote(s) found, do recursive processing
          quote_repl = blockquote(quote_repl);
        }

        for (let p of quote_repl.split(/\n{2,}/)) {
          quote_repl = quote_repl.replace(p, `<p>${p}</p>`);
        }

        p = p.replace(quote_str, `<blockquote>${quote_repl}</blockquote>`);
        quote = [];
      }
    }

    return p;
  };

  str = FlareTail.util.string.sanitize(str);

  // Quotes
  for (let p of str.split(/\n{2,}/)) {
    str = str.replace(p, `<p>${blockquote(p)}</p>`);
  }

  str = str.replace(/\n{2,}/gm, '').replace(/\n/gm, '<br>');

  // General links
  str = str.replace(
    /((https?|feed|ftps?|ircs?|mailto|news):(?:\/\/)?[\w-]+(\.[\w-]+)+((&amp;|[\w.,@?^=%$:\/~+#-])*(&amp;|[\w@?^=%$\/~+#-]))?)/gm,
    '<a href="$1">$1</a>'
  );

  // Email links
  // http://www.w3.org/TR/html5/forms.html#valid-e-mail-address
  str = str.replace(
    /^([a-zA-Z0-9.!#$%&\'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)$/,
    '<a href="mailto:$1">$1</a>'
  );

  // Bugs
  str = str.replace(
    /Bug\s*#?(\d+)/igm,
    '<a href="/bug/$1" data-bug-id="$1">Bug $1</a>' // l10n
  );

  // Attachments
  str = str.replace(
    /Attachment\s*#?(\d+)/igm,
    '<a href="/attachment/$1" data-attachment-id="$1">Attachment $1</a>' // l10n
  );

  return str;
};

BzDeck.core.get_name = function (person) {
  return person.real_name || person.email;
};

/* ----------------------------------------------------------------------------------------------
 * Session
 * ---------------------------------------------------------------------------------------------- */

BzDeck.session = {};

BzDeck.session.login = function () {
  let $app_login = document.querySelector('#app-login'),
      $app_body = document.querySelector('#app-body');

  BzDeck.core.$statusbar = document.querySelector('#statusbar');

  $app_login.setAttribute('aria-hidden', 'true');
  $app_body.removeAttribute('aria-hidden');

  // TODO: focus handling
};

BzDeck.session.logout = function () {
  let $app_login = document.querySelector('#app-login'),
      $app_body = document.querySelector('#app-body');

  BzDeck.core.$statusbar = $app_login.querySelector('[role="status"]');
  BzDeck.core.show_status('You have logged out.'); // l10n

  $app_login.removeAttribute('aria-hidden');
  $app_body.setAttribute('aria-hidden', 'true');

  BzDeck.bootstrap.show_login_form(false);

  // Terminate timers
  for (let [key, timer] of Iterator(BzDeck.core.timers)) {
    window.clearInterval(timer);
  }

  // Disconnect from the Bugzfeed server
  // BzDeck.bugzfeed.websocket.close();

  // Delete the account data
  BzDeck.model.data.account.active = false;
  BzDeck.model.save_account(BzDeck.model.data.account);

  delete BzDeck.model.data.account;
};

/* ----------------------------------------------------------------------------------------------
 * Toolbar
 * ---------------------------------------------------------------------------------------------- */

BzDeck.toolbar = {};

BzDeck.toolbar.setup = function () {
  let FTw = FlareTail.widget,
      FTu = FlareTail.util,
      mobile = FlareTail.util.device.type.startsWith('mobile'),
      phone = FlareTail.util.device.type === 'mobile-phone',
      tablist = this.tablist = new FTw.TabList(document.querySelector('#main-tablist')),
      $root = document.documentElement, // <html>
      $sidebar = document.querySelector('#sidebar');

  // Change the window title when a new tab is selected
  tablist.bind('Selected', event => {
    let $tab = event.detail.items[0],
        sidebar = BzDeck.sidebar.data,
        path = $tab.id.replace(/^tab-(.+)/, '$1'),
        title = $tab.title.replace('\n', ' – ');

    if (path === 'home') {
      if (!sidebar.folder_id) {
        sidebar.folder_id = 'inbox';
      }

      path = 'home/' + sidebar.folder_id;
    } else {
      path = path.replace(/^details-/, 'bug/').replace(/^(search)-/, '$1/');
    }

    $root.setAttribute('data-current-tab', path.split('/')[0]);
    path = '/' + path;

    if (location.pathname !== path) {
      history.pushState({}, title, path);
    }

    if (path.startsWith('/home/')) {
      BzDeck.HomePage.prototype.change_window_title(document.querySelector('#tab-home').title);
    } else {
      document.title = title;
      document.querySelector('[role="banner"] h1').textContent = $tab.textContent;
    }
  });

  new FTw.MenuBar(document.querySelector('#main-menu'));

  let $app_menu = document.querySelector('#main-menu--app-menu');

  $app_menu.addEventListener('MenuItemSelected', event => {
    switch (event.detail.command) {
      case 'show-settings': {
        new BzDeck.SettingsPage();

        break;
      }

      case 'toggle-fullscreen': {
        // Fullscreen requests from custom events are denied due to Bug 779324. A workaround below
        // FTu.app.toggle_fullscreen();
        break;
      }

      case 'install-app': {
        BzDeck.core.install_app();

        break;
      }

      case 'logout': {
        BzDeck.session.logout();

        break;
      }

      case 'quit': {
        window.close();

        break;
      }
    }
  });

  $app_menu.addEventListener('MenuClosed', event => {
    if (mobile) {
      // Keep the menu open
      $app_menu.removeAttribute('aria-expanded');
      // Hide the sidebar
      $root.setAttribute('data-sidebar-hidden', 'true');
      $sidebar.setAttribute('aria-hidden', 'true');
    }
  });

  $app_menu.setAttribute('aria-expanded', mobile);

  if (FTu.app.fullscreen_enabled) {
    {
      let $menuitem = document.querySelector('#main-menu--app--fullscreen');

      $menuitem.removeAttribute('aria-hidden');

      // A workaround for Bug 779324
      $menuitem.addEventListener('mousedown', event => {
        document.mozFullScreenElement ? document.mozCancelFullScreen()
                                      : document.body.mozRequestFullScreen();
      });
      $menuitem.addEventListener('keydown', event => {
        if (event.keyCode === event.DOM_VK_RETURN) {
          document.mozFullScreenElement ? document.mozCancelFullScreen()
                                        : document.body.mozRequestFullScreen();
        }
      });
    }
  }

  // Show the Quit menu item if the app runs on WebAppRT
  if (!window.locationbar.visible) {
    document.querySelector('#main-menu--app--quit').removeAttribute('aria-hidden');
  }

  let tabs = BzDeck.toolbar.tablist.view,
      $tab_home = document.querySelector('#tab-home');

  document.querySelector('[role="banner"] h1').addEventListener('click', event => {
    if (mobile) {
      if (phone && tabs.selected[0] === $tab_home) {
        let hidden = $sidebar.getAttribute('aria-hidden') !== 'true';

        document.querySelector('#sidebar > div').scrollTop = 0;
        $root.setAttribute('data-sidebar-hidden', hidden);
        $sidebar.setAttribute('aria-hidden', hidden);
      } else {
        tabs.selected = $tab_home;
      }
    }
  });

  $root.setAttribute('data-current-tab', 'home');

  // Account label & avatar
  let account = BzDeck.model.data.account,
      account_label = `${account.real_name ? `<strong>${account.real_name}</strong>` : '&nbsp;'}<br>${account.name}`,
      $account_label = document.querySelector('#main-menu--app--account label'),
      $account_img = new Image();

  $account_label.innerHTML = account_label;
  $account_img.addEventListener('load', event => {
    $account_label.style.backgroundImage = `url(${event.target.src})`;
  });
  $account_img.src = `https://www.gravatar.com/avatar/${md5(account.name)}?d=404`;

  FTu.app.can_install(BzDeck.config.app.manifest).then(() => {
    document.querySelector('#main-menu--app--install').removeAttribute('aria-hidden');
  }).catch(error => {});

  let $banner = document.querySelector('[role="banner"]'),
      $search_box = document.querySelector('[role="banner"] [role="search"] input'),
      $search_button = document.querySelector('[role="banner"] [role="search"] [role="button"]'),
      $search_dropdown = document.querySelector('#quicksearch-dropdown');

  this.search_dropdown = new FlareTail.widget.Menu($search_dropdown);

  let cleanup = () => {
    this.search_dropdown.close();
    $banner.classList.remove('search');
    $search_box.value = '';
    $search_button.focus();
  };

  let exec_search = () => {
    let page = new BzDeck.SearchPage(),
        params = new URLSearchParams(),
        terms = $search_box.value;

    if (terms) {
      page.view.panes['basic-search'].querySelector('.text-box [role="textbox"]').value = terms;
      params.append('short_desc', terms);
      params.append('short_desc_type', 'allwordssubstr');
      params.append('resolution', '---'); // Search only open bugs
      page.exec_search(params);
    }

    cleanup();
  };

  window.addEventListener('keydown', event => {
    if (event.keyCode === event.DOM_VK_K && (event.metaKey || event.ctrlKey)) {
      $search_box.focus();
      event.preventDefault();
    }
  });

  window.addEventListener('mousedown', event => cleanup());
  window.addEventListener('popstate', event => cleanup());

  $search_box.addEventListener('input', event => {
    if (event.target.value.trim()) {
      this.quicksearch(event);
    } else {
      this.search_dropdown.close();
    }
  });

  $search_box.addEventListener('keydown', event => {
    if ((event.keyCode === event.DOM_VK_UP || event.keyCode === event.DOM_VK_DOWN) &&
        event.target.value.trim() && this.search_dropdown.closed) {
      this.quicksearch(event);
    }

    if (event.keyCode === event.DOM_VK_RETURN) {
      this.search_dropdown.close();
      exec_search();
    }
  });

  $search_box.addEventListener('mousedown', event => {
    event.stopPropagation();
  });

  $search_button.addEventListener('keydown', event => {
    if (event.keyCode === event.DOM_VK_RETURN || event.keyCode === event.DOM_VK_SPACE) {
      exec_search();
    }
  });

  $search_button.addEventListener('mousedown', event => {
    event.stopPropagation();

    if (mobile) {
      if (!$banner.classList.contains('search')) {
        $banner.classList.add('search');
        // Somehow moving focus doesn't work, so use the async function here
        FlareTail.util.event.async(() => $search_box.focus());
      } else if ($search_box.value) {
        exec_search();
      }
    } else {
      exec_search();
    }
  });

  $search_dropdown.addEventListener('MenuItemSelected', event => {
    // Show the bug or search results
    let $target = event.detail.target,
        id = $target.dataset.id;

    if (id) {
      BzDeck.detailspage = new BzDeck.DetailsPage(Number.parseInt(id));
      cleanup();
    }

    if ($target.mozMatchesSelector('#quicksearch-dropdown-more')) {
      exec_search();
    }
  });

  // Suppress context menu
  $search_box.addEventListener('contextmenu', event => {
    return FTu.event.ignore(event);
  }, true); // use capture
};

BzDeck.toolbar.quicksearch = function (event) {
  let words = [for (word of event.target.value.trim().split(/\s+/)) word.toLowerCase()];

  BzDeck.model.get_all_bugs().then(bugs => {
    let results = bugs.filter(bug => {
      return (words.every(word => bug.summary.toLowerCase().contains(word)) ||
              words.length === 1 && !Number.isNaN(words[0]) && String(bug.id).contains(words[0])) &&
              BzDeck.model.data.server.config.field.status.open.indexOf(bug.status) > -1;
    });

    results.reverse();

    let data = [{
      'id': 'quicksearch-dropdown-header',
      'label': results.length ? 'Local Search' : 'Local Search: No Results', // l10n
      'disabled': true
    }];

    for (let [i, bug] of results.entries()) {
      data.push({
        'id': `quicksearch-dropdown-${bug.id}`,
        'label': `${bug.id} - ${bug.summary}`,
        'data': { 'id': bug.id }
      });

      if (i === 20) {
        break;
      }
    }

    data.push({ 'type': 'separator' });
    data.push({ 'id': 'quicksearch-dropdown-more', 'label': 'Search All Bugs...' }); // l10n

    let dropdown = this.search_dropdown;

    dropdown.build(data);
    dropdown.view.$container.scrollTop = 0;
    dropdown.open();
  });
};

/* ----------------------------------------------------------------------------------------------
 * Sidebar
 * ---------------------------------------------------------------------------------------------- */

BzDeck.sidebar = {};

BzDeck.sidebar.setup = function () {
  let FTw = FlareTail.widget,
      mobile = FlareTail.util.device.type.startsWith('mobile'),
      phone = FlareTail.util.device.type === 'mobile-phone',
      $root = document.documentElement, // <html>
      $sidebar = document.querySelector('#sidebar');

  if (mobile) {
    document.querySelector('#sidebar-account')
            .appendChild(document.querySelector('#main-menu--app--account'));
    document.querySelector('#sidebar-menu')
            .appendChild(document.querySelector('#main-menu--app-menu'));
  }

  $root.setAttribute('data-sidebar-hidden', phone);
  $sidebar.setAttribute('aria-hidden', phone);

  new FTw.ScrollBar($sidebar.querySelector('div'));

  $sidebar.addEventListener('click', event => {
    if (phone) {
      let hidden = $sidebar.getAttribute('aria-hidden') !== 'true';

      $root.setAttribute('data-sidebar-hidden', hidden);
      $sidebar.setAttribute('aria-hidden', hidden);
    }
  });

  this.folder_data = [
    {
      'id': 'sidebar-folders--inbox',
      'label': 'Inbox',
      'selected': true,
      'data': { 'id': 'inbox' }
    },
    {
      'id': 'sidebar-folders--starred',
      'label': 'Starred',
      'data': { 'id': 'starred' }
    },
    {
      'id': 'sidebar-folders--requests',
      'label': 'Requests',
      'data': { 'id': 'requests' }
    },
    {
      'id': 'sidebar-folders--cc',
      'label': 'CCed',
      'data': { 'id': 'cc' }
    },
    {
      'id': 'sidebar-folders--reported',
      'label': 'Reported',
      'data': { 'id': 'reported' }
    },
    {
      'id': 'sidebar-folders--assigned',
      'label': 'Assigned',
      'data': { 'id': 'assigned' }
    },
    {
      'id': 'sidebar-folders--mentor',
      'label': 'Mentor',
      'data': { 'id': 'mentor' }
    },
    {
      'id': 'sidebar-folders--qa',
      'label': 'QA Contact',
      'data': { 'id': 'qa' }
    },
    {
      'id': 'sidebar-folders--important',
      'label': 'Important',
      'data': { 'id': 'important' }
    },
    {
      'id': 'sidebar-folders--all',
      'label': 'All Bugs',
      'data': { 'id': 'all' }
    }
  ];

  let folders = this.folders
              = new FTw.ListBox(document.querySelector('#sidebar-folder-list'), this.folder_data);

  folders.bind('Selected', event => {
    this.data.folder_id = event.detail.ids[0];
  });

  this.data = new Proxy({
    'folder_id': null,
  },
  {
    'set': (obj, prop, newval) => {
      let oldval = obj[prop];

      // On mobile, the same folder can be selected
      if (!mobile && oldval === newval) {
        return;
      }

      if (prop === 'folder_id') {
        this.open_folder(newval);
      }

      obj[prop] = newval;
    }
  });

  window.addEventListener('UI:toggle_unread', event => {
    // Update the sidebar Inbox folder
    BzDeck.model.get_all_subscriptions().then(subscriptions => {
      let unread = new Set();

      for (let [key, bugs] of subscriptions) {
        for (let bug of bugs) if (event.detail.ids.has(bug.id)) {
          unread.add(bug.id);
        }
      }

      this.toggle_unread_ui(unread.size);
    });
  });
};

BzDeck.sidebar.open_folder = function (folder_id) {
  let home = BzDeck.homepage;

  home.data.preview_id = null;

  let update_list = bugs => {
    home.data.bug_list = bugs;
    FlareTail.util.event.async(() => {
      home.thread.update(bugs);
      document.querySelector('#home-list > footer').setAttribute('aria-hidden', bugs.length ? 'true' : 'false');
    });

    let unread_num = [for (bug of bugs) if (bug._unread) bug].length;

    if (unread_num > 0) {
      BzDeck.homepage.change_window_title(document.title += ` (${unread_num})`);
    }
  };

  let get_subscribed_bugs = () => new Promise((resolve, reject) => {
    BzDeck.model.get_all_subscriptions().then(subscriptions => {
      let ids = [];

      for (let [key, bugs] of subscriptions) {
        // Remove duplicates
        ids.push(...[for (bug of bugs) if (ids.indexOf(bug.id) === -1) bug.id]);
      }

      BzDeck.model.get_bugs_by_ids(ids).then(bugs => resolve(bugs));
    });
  });

  // Mobile compact layout
  if (FlareTail.util.device.type.startsWith('mobile') &&
      BzDeck.toolbar.tablist.view.selected[0].id !== 'tab-home') {
    // Select the home tab
    BzDeck.toolbar.tablist.view.selected = BzDeck.toolbar.tablist.view.members[0];
  }

  let folder_label = [for (f of this.folder_data) if (f.data.id === folder_id) f][0].label,
      folder_path = '/home/' + folder_id;

  // Change the window title and the tab label
  BzDeck.homepage.change_window_title(folder_label);

  // Save history
  if (location.pathname !== folder_path) {
    history.pushState({}, folder_label, folder_path);
  }

  if (folder_id === 'inbox') {
    get_subscribed_bugs().then(bugs => {
      let recent_time = Date.now() - 1000 * 60 * 60 * 24 * 11;

      // Recent bugs changed in 10 days + unread bugs
      update_list([for (bug of bugs)
                   if (new Date(bug.last_change_time) > recent_time || bug._unread) bug]);
    });
  }

  if (folder_id.match(/^(cc|reported|assigned|mentor|qa|requests)/)) {
    BzDeck.model.get_subscription_by_id(RegExp.$1).then(bugs => update_list(bugs));
  }

  if (folder_id === 'all') {
    get_subscribed_bugs().then(bugs => {
      update_list(bugs);
    });
  }

  if (folder_id === 'starred') {
    // Starred bugs may include non-subscribed bugs, so get ALL bugs
    BzDeck.model.get_all_bugs().then(bugs => {
      update_list([for (bug of bugs) if (!!bug._starred_comments && !!bug._starred_comments.size) bug]);
    });
  }

  if (folder_id === 'important') {
    get_subscribed_bugs().then(bugs => {
      let severities = ['blocker', 'critical', 'major'];

      update_list([for (bug of bugs) if (severities.indexOf(bug.severity) > -1) bug]);
    });
  }
};

BzDeck.sidebar.toggle_unread_ui = function (num) {
  let $label = document.querySelector('#sidebar-folders--inbox label'),
      $num = $label.querySelector('span');

  if (num) {
    $num = $num || $label.appendChild(document.createElement('span'));
    $num.textContent = num;
  } else if ($num) {
    $num.remove();
  }
};

/* ----------------------------------------------------------------------------------------------
 * Events
 * ---------------------------------------------------------------------------------------------- */

window.addEventListener('DOMContentLoaded', event => {
  BzDeck.bootstrap.processing = true;

  if (FlareTail.util.compatible) {
    BzDeck.bootstrap.start();
  }
});

window.addEventListener('contextmenu', event => {
  event.preventDefault();
});

window.addEventListener('dragenter', event => event.preventDefault());
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());

window.addEventListener('wheel', event => {
  event.preventDefault();
});

window.addEventListener('click', event => {
  let $target = event.target;

  // Discard clicks on the fullscreen dialog
  if ($target === document) {
    return true;
  }

  if ($target.mozMatchesSelector(':link')) {
    // Bug link: open in a new app tab
    if ($target.hasAttribute('data-bug-id')) {
      BzDeck.detailspage = new BzDeck.DetailsPage(
        Number.parseInt($target.getAttribute('data-bug-id'))
      );

      event.preventDefault();

      return false;
    }

    // Attachment link: open in a new browser tab (TEMP)
    if ($target.hasAttribute('data-attachment-id')) {
      window.open(BzDeck.model.data.server.url + '/attachment.cgi?id='
                   + $target.getAttribute('data-attachment-id'), '_blank');

      event.preventDefault();

      return false;
    }

    // Normal link: open in a new browser tab
    $target.target = '_blank';

    return false;
  }

  return true;
});

window.addEventListener('keydown', event => {
  let $target = event.target;

  if ($target.mozMatchesSelector('input, [role="textbox"]')) {
    if (event.metaKey || event.ctrlKey) {
      switch (event.keyCode) {
        case event.DOM_VK_A: // Select
        case event.DOM_VK_C: // Copy
        case event.DOM_VK_V: // Paste
        case event.DOM_VK_X: // Cut
        case event.DOM_VK_Z: { // Undo/Redo
          return true;
        }

        default: {
          event.preventDefault();

          return false;
        }
      }
    }
  }

  if (event.metaKey || event.ctrlKey) {
    switch (event.keyCode) {
      // Disable some keyboard shortcuts
      case event.DOM_VK_A: // Select All
      case event.DOM_VK_B: // Bookmark Sidebar
      case event.DOM_VK_F: // Find
      case event.DOM_VK_G: // Find Again
      case event.DOM_VK_H: // History Sidebar
      case event.DOM_VK_O: // Open File
      case event.DOM_VK_Q: // Quit
      case event.DOM_VK_R: // Reload
      case event.DOM_VK_S: // Save
      case event.DOM_VK_W: // Close Tab/Window
      case event.DOM_VK_ADD: // Zoom In
      case event.DOM_VK_SUBTRACT: { // Zoom Out
        event.preventDefault();

        return false;
      }
    }
  }

  return true;
});

window.addEventListener('popstate', event => {
  let path = location.pathname.substr(1).replace('/', '-'),
      tabs = BzDeck.toolbar.tablist.view,
      folders = BzDeck.sidebar.folders.view,
      $tab,
      $folder,
      $root = document.documentElement; // <html>

  // Hide sidebar
  if (FlareTail.util.device.type.startsWith('mobile')) {
    $root.setAttribute('data-sidebar-hidden', 'true');
    document.querySelector('#sidebar').setAttribute('aria-hidden', 'true');
  }

  if (path.match(/^bug-(\d+)$/)) {
    let bug_id = Number.parseInt(RegExp.$1),
        bug_list = [];

    $root.setAttribute('data-current-tab', 'bug');
    $tab = document.querySelector(`#tab-details-${bug_id}`);

    if ($tab) {
      tabs.selected = $tab;

      return;
    }

    if (BzDeck.detailspage) {
      bug_list = BzDeck.detailspage.data.bug_list;

      if (bug_list.length) {
        let bugs = [for (bug of bug_list) bug.id],
            index = bugs.indexOf(BzDeck.detailspage.data.id);

        if (bugs[index - 1] === bug_id || bugs[index + 1] === bug_id) {
          // Back or Forward navigation
          BzDeck.toolbar.tablist.close_tab(BzDeck.detailspage.view.$tab);
        }
      }
    }

    BzDeck.detailspage = new BzDeck.DetailsPage(bug_id, bug_list);

    return;
  }

  if (path.match(/^home-(\w+)/)) {
    $folder = document.querySelector(`#sidebar-folders--${RegExp.$1}`);

    if ($folder) {
      $root.setAttribute('data-current-tab', 'home');
      tabs.selected = document.querySelector('#tab-home');
      folders.selected = $folder;

      return;
    }
  }

  $tab = document.querySelector(`#tab-${CSS.escape(path)}`);

  if ($tab) {
    $root.setAttribute('data-current-tab', path);
    tabs.selected = $tab;

    return;
  }

  // Fallback
  $root.setAttribute('data-current-tab', 'home');
  tabs.selected = document.querySelector('#tab-home');
  folders.selected = document.querySelector('#sidebar-folders--inbox');
});

window.addEventListener('UI:toggle_unread', event => {
  let bugs = [...event.detail.bugs];

  if (document.documentElement.getAttribute('data-current-tab') === 'home') {
    let unread_num = [for (bug of BzDeck.homepage.data.bug_list) if (bug._unread) bug].length;

    BzDeck.homepage.change_window_title(
      document.title.replace(/(\s\(\d+\))?$/, unread_num ? ` (${unread_num})` : '')
    );
  }

  if (!event.detail.loaded) {
    return;
  }

  if (bugs.length === 0) {
    BzDeck.core.show_status('No new bugs to download'); // l10n

    return;
  }

  bugs.sort((a, b) => new Date(b.last_change_time) - new Date(a.last_change_time));

  let status = bugs.length > 1 ? 'You have %d unread bugs'.replace('%d', bugs.length)
                               : 'You have 1 unread bug', // l10n
      extract = [for (bug of bugs.slice(0, 3)) `${bug.id} - ${bug.summary}`].join('\n');

  BzDeck.core.show_status(status);
  BzDeck.core.show_notification(status, extract);
});
