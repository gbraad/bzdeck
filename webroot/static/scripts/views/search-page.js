/**
 * BzDeck Search Page View
 * Copyright © 2015 Kohei Yoshino. All rights reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

BzDeck.views.SearchPage = function SearchPageView (id, params, config, prefs) {
  this.id = id;
  this.$tabpanel = document.querySelector(`#tabpanel-search-${id}`);
  this.$status = this.$tabpanel.querySelector('[role="status"]');
  this.buttons = {};
  this.panes = {};

  this.setup_basic_search_pane(config);
  this.setup_result_pane(prefs);
  this.setup_preview_pane();
  this.setup_toolbar();

  Object.defineProperties(this, {
    'preview_is_hidden': {
      'enumerable': true,
      'get': () => FlareTail.util.ua.device.mobile
    },
  });

  if (params) {
    // TODO: support other params
    this.panes['basic-search'].querySelector('.text-box [role="textbox"]').value = params.get('short_desc') || '';
  }

  let $grid = this.panes['result'].querySelector('[role="grid"]');

  this.on('C:Offline', data => {
    this.show_status('You have to go online to search bugs.'); // l10n
  });

  this.on('C:SearchStarted', data => {
    $grid.removeAttribute('aria-hidden');
    $grid.setAttribute('aria-busy', 'true');
    this.hide_status();
    this.thread.update([]); // Clear grid body
  });

  this.on('C:SearchResultsAvailable', data => {
    if (data.bugs.length > 0) {
      this.thread.update(data.bugs);
      this.hide_status();
    } else {
      this.show_status('Zarro Boogs found.'); // l10n
    }
  });

  this.on('C:SearchError', data => {
    this.show_status(data.error.message);
  });

  this.on('C:SearchComplete', data => {
    $grid.removeAttribute('aria-busy');
  });

  this.on('C:BugDataUnavailable', data => this.show_preview(undefined));
  this.on('C:BugDataAvailable', data => this.show_preview(data.bug));
  this.on('C:ReturnToBasicSearchPane', data => this.show_basic_search_pane());
};

BzDeck.views.SearchPage.prototype = Object.create(BzDeck.views.BaseView.prototype);
BzDeck.views.SearchPage.prototype.constructor = BzDeck.views.SearchPage;

BzDeck.views.SearchPage.prototype.setup_toolbar = function () {
  let handler = event => {
    this.trigger(':ToolbarButtonPressed', { 'command': event.target.dataset.command });
  };

  for (let $button of this.$tabpanel.querySelectorAll('header [role="button"]')) {
    let $$button = this.buttons[$button.dataset.command] = new this.widget.Button($button);

    $$button.bind('Pressed', handler);
  }
};

BzDeck.views.SearchPage.prototype.setup_basic_search_pane = function (config) {
  let $pane = this.panes['basic-search'] = this.$tabpanel.querySelector('[id$="-basic-search-pane"]');

  // Custom scrollbar
  for (let $outer of $pane.querySelectorAll('[id$="-list-outer"]')) {
    new this.widget.ScrollBar($outer, true);
  }

  let $classification_list = $pane.querySelector('[id$="-browse-classification-list"]'),
      $product_list = $pane.querySelector('[id$="-browse-product-list"]'),
      $component_list = $pane.querySelector('[id$="-browse-component-list"]'),
      $status_list = $pane.querySelector('[id$="-browse-status-list"]'),
      $resolution_list = $pane.querySelector('[id$="-browse-resolution-list"]');

  let classifications = Object.keys(config.classification).sort().map((value, index) => ({
    'id': `${$classification_list.id}item-${index}`,
    'label': value
  }));

  let products = Object.keys(config.product).sort().map((value, index) => ({
    'id': `${$product_list.id}item-${index}`,
    'label': value
  }));

  let components = [];

  for (let [key, { 'component': cs }] of Iterator(config.product)) {
    components.push(...[for (c of Object.keys(cs)) if (!components.includes(c)) c]);
  }

  components = components.sort().map((value, index) => ({
    'id': `${$component_list.id}item-${index}`,
    'label': value
  }));

  let statuses = config.field.status.values.map((value, index) => ({
    'id': `${$status_list.id}item-${index}`,
    'label': value
  }));

  let resolutions = config.field.resolution.values.map((value, index) => ({
    'id': `${$resolution_list.id}item-${index}`,
    'label': value || '---',
    'selected': !value // Select '---' to search open bugs
  }));

  let ListBox = this.widget.ListBox,
      $$classification_list = new ListBox($classification_list, classifications),
      $$product_list = new ListBox($product_list, products),
      $$component_list = new ListBox($component_list, components),
      $$status_list = new ListBox($status_list, statuses),
      $$resolution_list = new ListBox($resolution_list, resolutions);

  $$classification_list.bind('Selected', event => {
    let products = [],
        components = [];

    for (let classification of event.detail.labels) {
      products.push(...config.classification[classification].products);
    }

    for (let product of products) {
      components.push(...Object.keys(config.product[product].component));
    }

    $$product_list.filter(products);
    $$component_list.filter(components);
  });

  $$product_list.bind('Selected', event => {
    let components = [];

    for (let product of event.detail.labels) {
      components.push(...Object.keys(config.product[product].component));
    }

    $$component_list.filter(components);
  });

  let $textbox = $pane.querySelector('.text-box [role="textbox"]'),
      $$button = new this.widget.Button($pane.querySelector('.text-box [role="button"]'));

  $$button.bind('Pressed', event => {
    let params = new URLSearchParams(),
        map = {
          'classification': $classification_list,
          'product': $product_list,
          'component': $component_list,
          'status': $status_list,
          'resolution': $resolution_list
        };

    for (let [name, list] of Iterator(map)) {
      for (let $opt of list.querySelectorAll('[aria-selected="true"]')) {
        params.append(name, $opt.textContent);
      }
    }

    if ($textbox.value) {
      params.append('short_desc', $textbox.value);
      params.append('short_desc_type', 'allwordssubstr');
    }

    this.trigger(':SearchRequested', { params });
  });
};

BzDeck.views.SearchPage.prototype.setup_result_pane = function (prefs) {
  let $pane = this.panes['result'] = this.$tabpanel.querySelector('[id$="-result-pane"]'),
      mobile = FlareTail.util.ua.device.mobile;

  this.thread = new BzDeck.views.ClassicThread(this, 'search', $pane.querySelector('[role="grid"]'), {
    'sortable': true,
    'reorderable': true,
    'sort_conditions': mobile ? { 'key': 'last_change_time', 'order': 'descending' }
                              : prefs['home.list.sort_conditions'] || { 'key': 'id', 'order': 'ascending' }
  });

  let $$grid = this.thread.$$grid;

  // Force to change the sort condition when switched to the mobile layout
  if (mobile) {
    let cond = $$grid.options.sort_conditions;

    cond.key = 'last_change_time';
    cond.order = 'descending';
  }

  $pane.addEventListener('transitionend', event => {
    let selected = $$grid.view.selected;

    if (event.propertyName === 'bottom' && selected.length) {
      $$grid.ensure_row_visibility(selected[selected.length - 1]);
    }
  });
};

BzDeck.views.SearchPage.prototype.setup_preview_pane = function () {
  let $pane = this.panes['preview'] = this.$tabpanel.querySelector('[id$="-preview-pane"]'),
      $bug = $pane.querySelector('article'),
      $info = this.get_fragment('preview-bug-info').firstElementChild;

  $bug.appendChild($info).id = `${$bug.id}-info`;
};

BzDeck.views.SearchPage.prototype.get_shown_bugs = function (bugs) {
  let rows = this.thread.$$grid.view.$body.querySelectorAll('[role="row"]:not([aria-hidden="true"])');

  return [for ($row of rows) bugs.get(Number($row.dataset.id))];
};

BzDeck.views.SearchPage.prototype.show_preview = function (bug) {
  let $pane = this.panes['preview'],
      $bug = $pane.querySelector('[id$="-preview-bug"]');

  if (!bug) {
    $bug.setAttribute('aria-hidden', 'true');

    return;
  }

  // Show the preview pane
  if ($pane.matches('[aria-hidden="true"]')) {
    this.hide_status();
    this.panes['basic-search'].setAttribute('aria-hidden', 'true');
    $pane.setAttribute('aria-hidden', 'false');
    this.buttons['show-details'].data.disabled = false;
    this.buttons['show-basic-search-pane'].data.disabled = false;
  }

  // Fill the content
  this.$$bug = this.$$bug || new BzDeck.views.Bug($bug);
  this.$$bug.render(bug);
  $bug.setAttribute('aria-hidden', 'false');
};

BzDeck.views.SearchPage.prototype.show_basic_search_pane = function () {
  this.panes['basic-search'].setAttribute('aria-hidden', 'false');
  this.panes['preview'].setAttribute('aria-hidden', 'true');
  this.buttons['show-details'].data.disabled = true;
  this.buttons['show-basic-search-pane'].data.disabled = true;
};

BzDeck.views.SearchPage.prototype.show_status = function (str) {
  this.$status.firstElementChild.textContent = str;
  this.$status.setAttribute('aria-hidden', str === '');
  this.panes['result'].querySelector('[role="grid"]').setAttribute('aria-hidden', str !== '');
};

BzDeck.views.SearchPage.prototype.hide_status = function () {
  this.show_status('');
};
