/**
 * BzDeck Bug Panes View
 * Copyright © 2015 Kohei Yoshino. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

BzDeck.views.Bug = function BugView ($bug) {
  this.$bug = $bug;

  // Custom scrollbars
  this.scrollbars = new Set([for ($area of this.$bug.querySelectorAll('[role="region"]'))
                                  new this.widget.ScrollBar($area)]);

  this.on('Bug:StarToggled', data => {
    let _bug = data.bug,
        _starred = _bug._starred_comments;

    if (this.$bug && _bug.id === this.bug.id) {
      this.$bug.querySelector('header [role="button"][data-command="star"]')
               .setAttribute('aria-pressed', !!_starred.size);

      for (let $comment of this.$bug.querySelectorAll('[role="article"] [itemprop="comment"][data-id]')) {
        $comment.querySelector('[role="button"][data-command="star"]')
                .setAttribute('aria-pressed', _starred.has(Number.parseInt($comment.dataset.id)));
      }
    }
  });

  this.on('Bug:Updated', data => {
    if (data.bug.id === this.bug.id) {
      this.update(data.bug, data.changes);
    }
  });
};

BzDeck.views.Bug.prototype = Object.create(BzDeck.views.BaseView.prototype);
BzDeck.views.Bug.prototype.constructor = BzDeck.views.Bug;

BzDeck.views.Bug.prototype.render = function (bug, partial = false) {
  this.bug = bug;
  this.$bug.dataset.id = this.bug.id;

  if (!this.bug.summary && !this.bug._update_needed) {
    // The bug is being loaded
    return;
  }

  let _bug = {};

  for (let { 'id': field, type } of BzDeck.config.grid.default_columns) {
    if (this.bug[field] !== undefined && !field.startsWith('_')) {
      if (field === 'keywords') {
        _bug.keyword = this.bug.keywords;
      } else if (field === 'mentors') {
        _bug.mentor = [for (person of this.bug.mentors_detail) {
          'name': BzDeck.controllers.users.get_name(person),
          'email': person.email,
          'image': 'https://secure.gravatar.com/avatar/' + md5(person.email) + '?d=mm'
        }];
      } else if (type === 'person') {
        if (this.bug[field]) {
          let person = this.bug[`${field}_detail`];

          _bug[field] = {
            'name': BzDeck.controllers.users.get_name(person),
            'email': person.email,
            'image': 'https://secure.gravatar.com/avatar/' + md5(person.email) + '?d=mm'
          };
        }
      } else {
        _bug[field] = this.bug[field] || '';
      }
    }
  }

  this.fill(this.$bug, _bug);

  this.set_product_tooltips();

  let $button = this.$bug.querySelector('[role="button"][data-command="star"]'),
      $timeline = this.$bug.querySelector('.bug-timeline');

  // Star on the header
  if ($button) {
    $button.setAttribute('aria-pressed', BzDeck.controllers.bugs.is_starred(this.bug));
    (new this.widget.Button($button)).bind('Pressed', event =>
      BzDeck.controllers.bugs.toggle_star(this.bug.id, event.detail.pressed));
  }

  if (!$timeline) {
    return;
  }

  $timeline.setAttribute('aria-busy', 'true');
  BzDeck.views.statusbar.show('Loading...'); // l10n

  // Empty timeline while keeping the scrollbar
  if (!partial) {
    for (let $comment of $timeline.querySelectorAll('article, [role="form"], .read-comments-expander')) {
      $comment.remove();
    }
  }

  if (this.bug.comments && !this.bug._update_needed || partial) {
    FlareTail.util.event.async(() => this.fill_details(partial, false));
  } else {
    // Load comments, history, flags and attachments' metadata
    BzDeck.controllers.bugs.fetch_bug(this.bug.id, false).then(bug_details => { // Exclude metadata
      this.bug = Object.assign(this.bug, bug_details); // Merge data
      BzDeck.models.bugs.save_bug(this.bug);
      FlareTail.util.event.async(() => this.fill_details(false, true));
    });
  }

  // Focus management
  let set_focus = shift => {
    let ascending = BzDeck.models.data.prefs['ui.timeline.sort.order'] !== 'descending',
        entries = [...$timeline.querySelectorAll('[itemprop="comment"]')];

    entries = ascending && shift || !ascending && !shift ? entries.reverse() : entries;

    // Focus the first (or last) visible entry
    for (let $_entry of entries) if ($_entry.clientHeight) {
      $_entry.focus();
      $_entry.scrollIntoView(ascending);

      break;
    }
  };

  // Assign keyboard shortcuts
  if (!$timeline.hasAttribute('keyboard-shortcuts-enabled')) {
    FlareTail.util.kbd.assign($timeline, {
      // Toggle read
      'M': event => BzDeck.controllers.bugs.toggle_unread(this.bug.id, !this.bug._unread),
      // Toggle star
      'S': event => BzDeck.controllers.bugs.toggle_star(this.bug.id, !BzDeck.controllers.bugs.is_starred(this.bug)),
      // Reply
      'R': event => document.querySelector(`#${$timeline.id}-comment-form [role="textbox"]`).focus(),
      // Focus management
      'PAGE_UP|SHIFT+SPACE': event => set_focus(true),
      'PAGE_DOWN|SPACE': event => set_focus(false),
    });

    $timeline.setAttribute('keyboard-shortcuts-enabled', 'true');
  }
};

BzDeck.views.Bug.prototype.fill_details = function (partial, delayed) {
  // When the comments and history are loaded async, the template can be removed
  // or replaced at the time of call, if other bug is selected by user
  if (!this.$bug || Number.parseInt(this.$bug.dataset.id) !== this.bug.id) {
    return;
  }

  let _bug = {
    'cc': [for (person of this.bug.cc_detail) {
      'name': BzDeck.controllers.users.get_name(person, true),
      'email': person.email,
      'image': 'https://secure.gravatar.com/avatar/' + md5(person.email) + '?d=mm'
    }],
    'depends_on': this.bug.depends_on,
    'blocks': this.bug.blocks,
    'see_also': this.bug.see_also,
    'flag': [for (flag of this.bug.flags) {
      'creator': {
        'name': flag.setter, // email
        'email': flag.setter
      },
      'name': flag.name,
      'status': flag.status
    }]
  };

  if (this.bug.dupe_of) {
    _bug.resolution = `DUPLICATE of ${this.bug.dupe_of}`;
  }

  this.fill(this.$bug, _bug);

  // Depends on & Blocks
  for (let $li of this.$bug.querySelectorAll('[itemprop="depends_on"], [itemprop="blocks"]')) {
    $li.setAttribute('data-bug-id', $li.itemValue);

    (new this.widget.Button($li)).bind('Pressed', event =>
      BzDeck.router.navigate('/bug/' + event.target.textContent));
  }

  // See Also
  for (let $link of this.$bug.querySelectorAll('[itemprop="see_also"]')) {
    let re = new RegExp(`^${BzDeck.models.data.server.url}/show_bug.cgi\\?id=(\\d+)$`.replace(/\./g, '\\.')),
        match = $link.href.match(re);

    if (match) {
      $link.text = match[1];
      $link.setAttribute('data-bug-id', match[1]);
      $link.setAttribute('role', 'button');
    } else {
      $link.text = $link.href;
    }
  }

  // Flags
  let $flags = this.$bug.querySelector('[data-field="flags"]');

  if ($flags) {
    $flags.setAttribute('aria-hidden', !this.bug.flags.length);
  }

  // TODO: Show Project Flags and Tracking Flags

  if (!partial) {
    FlareTail.util.event.async(() => {
      // Timeline: comments, attachments & history
      this.timeline = new BzDeck.views.Timeline(this.bug, this.$bug, delayed);

      // Attachments and History, only on the details tabs
      new BzDeck.views.DetailsPageAttachments(this.$bug, this.bug.attachments);
      new BzDeck.views.DetailsPageHistory(this.$bug, this.bug.history);

      // Add tooltips to the related bugs
      this.set_bug_tooltips();

      // Force updating the scrollbars because sometimes those are not automatically updated
      this.scrollbars.forEach($$scrollbar => $$scrollbar.set_height());
    });
  }

  BzDeck.views.statusbar.show('');
};

BzDeck.views.Bug.prototype.set_product_tooltips = function () {
  let config = BzDeck.models.data.server.config,
      strip_tags = str => FlareTail.util.string.strip_tags(str).replace(/\s*\(more\ info\)$/i, ''),
      classification = config.classification[this.bug.classification],
      product = config.product[this.bug.product],
      component,
      $classification = this.$bug.querySelector('[itemprop="classification"]'),
      $product = this.$bug.querySelector('[itemprop="product"]'),
      $component;

  if ($classification && classification) {
    $classification.title = strip_tags(classification.description);
  }

  if (!product) {
    return;
  }

  if ($product) {
    $product.title = strip_tags(product.description);
  }

  component = product.component[this.bug.component];
  $component = this.$bug.querySelector('[itemprop="component"]');

  if ($component && component) {
    $component.title = strip_tags(component.description);
  }
};

BzDeck.views.Bug.prototype.set_bug_tooltips = function () {
  let related_bug_ids = new Set([for ($element of this.$bug.querySelectorAll('[data-bug-id]'))
                                Number.parseInt($element.getAttribute('data-bug-id'))]);
  let set_tooltops = bug => {
    if (bug.summary) {
      let title = `${bug.status} ${bug.resolution || ''} – ${bug.summary}`;

      for (let $element of this.$bug.querySelectorAll(`[data-bug-id="${bug.id}"]`)) {
        $element.title = title;
        $element.dataset.status = bug.status;
        $element.dataset.resolution = bug.resolution || '';
      }
    }
  };

  if (related_bug_ids.size) {
    BzDeck.models.bugs.get_bugs_by_ids(related_bug_ids).then(bugs => {
      let found_bug_ids = [for (bug of bugs) bug.id],
          lookup_bug_ids = [for (id of related_bug_ids) if (!found_bug_ids.includes(id)) id];

      bugs.map(set_tooltops);

      if (lookup_bug_ids.length) {
        BzDeck.controllers.bugs.fetch_bugs(lookup_bug_ids).then(bugs => {
          BzDeck.models.bugs.save_bugs(bugs);
          bugs.map(set_tooltops);
        });
      }
    });
  }
};

BzDeck.views.Bug.prototype.update = function (bug, changes) {
  this.bug = bug;

  let $timeline = this.$bug.querySelector('.bug-timeline');

  if ($timeline) {
    $timeline.querySelector('.comments-wrapper')
             .appendChild(new BzDeck.views.TimelineEntry($timeline.id, this.bug, changes)).scrollIntoView();
  }

  if (changes.has('attachment') && this.$bug.querySelector('[data-field="attachments"]')) {
    new BzDeck.views.DetailsPageAttachments(this.$bug, [changes.get('attachment')], true);
  }

  if (changes.has('history') && this.$bug.querySelector('[data-field="history"]')) {
    let _bug = { 'id': this.bug.id, '_update_needed': true };

    // Prep partial data
    for (let change in changes.get('history').changes) {
      _bug[change.field_name] = this.bug[change.field_name];
    }

    this.fill(_bug, true);
    new BzDeck.views.DetailsPageHistory(this.$bug, [changes.get('history')], true);
  }
};
