const visualEditorHost = document.getElementById('visual-editor');
const previewContent = document.getElementById('preview-content');
const lintSummary = document.getElementById('lint-summary');
const lintIssues = document.getElementById('lint-issues');
const editorContentCssUrl = new URL('preview.css', window.location.href).href;

let htmlSource = '';
let inlineLintTimer = null;
let previewCssCache = '';

const INLINE_LINT_CLASS = 'lint-target-inline';
const INLINE_LINT_WARNING_CLASS = 'lint-warning';
const INLINE_LINT_ERROR_CLASS = 'lint-error';

function ensureStylesheetLink(doc, href) {
	if (!doc) {
		return;
	}

	const existing = doc.querySelector(`link[href="${href}"]`);
	if (existing) {
		return;
	}

	const link = doc.createElement('link');
	link.rel = 'stylesheet';
	link.href = href;
	doc.head.appendChild(link);
}

function ensureEditorStylesheet(editor) {
	const iframeDoc = editor.getDoc();
	if (!iframeDoc) {
		return;
	}

	ensureStylesheetLink(iframeDoc, editorContentCssUrl);
}

function applyPreviewDialogStyles(previewCssText, attempts = 8) {
	const frame = document.querySelector('.tox-dialog iframe');
	if (!frame) {
		if (attempts > 0) {
			window.setTimeout(() => applyPreviewDialogStyles(previewCssText, attempts - 1), 80);
		}
		return;
	}

	const applyToDoc = async () => {
		const frameDoc = frame.contentDocument;
		if (!frameDoc) {
			if (attempts > 0) {
				window.setTimeout(() => applyPreviewDialogStyles(previewCssText, attempts - 1), 80);
			}
			return;
		}

		if (frameDoc.body) {
			frameDoc.body.classList.add('preview');
		}

		let cssText = previewCssText || previewCssCache;
		if (!cssText) {
			cssText = await loadPreviewCssText();
			previewCssCache = cssText;
		}

		if (cssText) {
			let styleNode = frameDoc.getElementById('preview-inline-style');
			if (!styleNode) {
				styleNode = frameDoc.createElement('style');
				styleNode.id = 'preview-inline-style';
				frameDoc.head.appendChild(styleNode);
			}
			styleNode.textContent = cssText;
		}
	};

	if (frame.contentDocument?.readyState === 'complete') {
		applyToDoc();
		return;
	}

	frame.addEventListener('load', applyToDoc, { once: true });
	window.setTimeout(applyToDoc, 120);
}

function schedulePreviewDialogStyling(previewCssText, durationMs = 3200) {
	const startedAt = Date.now();
	const tick = () => {
		applyPreviewDialogStyles(previewCssText, 1);

		if (Date.now() - startedAt < durationMs) {
			window.setTimeout(tick, 80);
		}
	};

	tick();
}

function watchPreviewDialog(previewCssText) {
	const observer = new MutationObserver(() => {
		schedulePreviewDialogStyling(previewCssText, 1400);
	});

	observer.observe(document.body, { childList: true, subtree: true });
	return observer;
}

function absolutizeCssUrls(cssText, baseHref) {
	return cssText.replace(/url\((['"]?)([^'")]+)\1\)/g, (match, quote, rawPath) => {
		const path = rawPath.trim();
		if (!path || path.startsWith('data:') || path.startsWith('http://') || path.startsWith('https://') || path.startsWith('file://') || path.startsWith('/')) {
			return match;
		}

		const absolute = new URL(path, baseHref).href;
		return `url(${quote}${absolute}${quote})`;
	});
}

async function loadPreviewCssText() {
	try {
		const response = await fetch(editorContentCssUrl);
		if (!response.ok) {
			return '';
		}

		const rawCss = await response.text();
		return absolutizeCssUrls(rawCss, editorContentCssUrl);
	} catch (_error) {
		return '';
	}
}

function sanitizeHtml(html) {
	return html.replace(/\u200B/g, '');
}

function clearInlineLintMarkers(root) {
	if (!root) {
		return;
	}

	root.querySelectorAll(`.${INLINE_LINT_CLASS}`).forEach((element) => {
		element.classList.remove(INLINE_LINT_CLASS, INLINE_LINT_WARNING_CLASS, INLINE_LINT_ERROR_CLASS);
		element.removeAttribute('title');
	});
}

function markLintTarget(element, issueType, inlineMode) {
	if (!element) {
		return;
	}

	if (inlineMode) {
		element.classList.add(INLINE_LINT_CLASS);
		element.classList.add(issueType === 'Error' ? INLINE_LINT_ERROR_CLASS : INLINE_LINT_WARNING_CLASS);
		return;
	}

	element.classList.add('lint-target');
}

function lintContent(contentRoot, inlineMode = false) {
	const issues = [];
	const headingNodes = contentRoot.querySelectorAll('h1, h2, h3, h4, h5, h6');
	const codeBlocks = contentRoot.querySelectorAll('pre');
	const divBlocks = contentRoot.querySelectorAll('div');
	const styledElements = contentRoot.querySelectorAll('[style]');

	divBlocks.forEach((block) => {
		markLintTarget(block, 'Warning', inlineMode);
		if (inlineMode) {
			block.title = 'Div blocks are not allowed';
		}
		issues.push({
			title: 'Div block found',
			message: 'Replace div blocks with appropriate semantic elements. Div blocks are not allowed.',
			type: 'Warning'
		});
	});

	styledElements.forEach((element) => {
		if (element.tagName.toLowerCase() === 'pre') {
			return;
		}

		markLintTarget(element, 'Warning', inlineMode);
		if (inlineMode) {
			element.title = 'Inline styles are only allowed on pre elements';
		}
		issues.push({
			title: 'Inline styles are restricted',
			message: 'Only pre elements are allowed to use inline styles. Move styles to a stylesheet or remove the style attribute.',
			type: 'Warning'
		});
	});

	headingNodes.forEach((heading) => {
		markLintTarget(heading, 'Warning', inlineMode);
		if (inlineMode) {
			heading.title = 'Heading styles are not allowed';
		}
	});

	codeBlocks.forEach((block) => {
		const text = block.textContent.trim();
		if (!text) {
			markLintTarget(block, 'Error', inlineMode);
			if (inlineMode) {
				block.title = 'Empty code block';
			}
			issues.push({
				title: 'Empty code block',
				message: 'Remove the block or add code before publishing. Empty code blocks are not allowed.',
				type: 'Error'
			});
		}
	});

	if (headingNodes.length > 0) {
		issues.unshift({
			title: 'Heading styles are not allowed',
			message: 'Replace headings with body text, bold text, or a list item. The preview is flagging every heading level found.',
			type: 'Warning'
		});
	}

	return issues;
}

function extractEditorHtml(editor) {
	const body = editor?.getBody();
	if (!body) {
		return '';
	}

	const clone = body.cloneNode(true);
	clearInlineLintMarkers(clone);
	return sanitizeHtml(clone.innerHTML);
}

function applyInlineLint(editor) {
	const body = editor?.getBody();
	if (!body) {
		return;
	}

	clearInlineLintMarkers(body);
	lintContent(body, true);
}

function renderPreview(html) {
	html = sanitizeHtml(html);
	const previewRoot = document.createElement('div');
	const isEmpty = html.trim() === '' || html === '<p><br></p>';

	previewRoot.innerHTML = isEmpty
		? '<div class="empty">Your formatted content will appear here as you type.</div>'
		: html;
	const issues = isEmpty ? [] : lintContent(previewRoot);

	previewContent.innerHTML = previewRoot.innerHTML;
	lintIssues.innerHTML = issues.length
		? issues.map((issue) => `
			<div class="lint-item">
				<span class="lint-badge">${issue.type}</span>
				<div class="lint-copy">
					<strong>${issue.title}</strong>
					<p>${issue.message}</p>
				</div>
			</div>
		`).join('')
		: '';

	lintSummary.innerHTML = issues.length
		? `<strong>${issues.length} issue${issues.length === 1 ? '' : 's'} found</strong><p>Review the warnings below. The preview highlights offending content directly so you can fix it in place.</p>`
		: '<strong>No issues found</strong><p>Keep typing. The preview will flag unsupported formatting and content problems in real time.</p>';
}

function updateFromVisual() {
	if (!tinymce.activeEditor) {
		return;
	}

	applyInlineLint(tinymce.activeEditor);
	htmlSource = extractEditorHtml(tinymce.activeEditor);
	renderPreview(htmlSource);
}

function scheduleInlineLint(editor) {
	if (inlineLintTimer !== null) {
		window.clearTimeout(inlineLintTimer);
	}

	inlineLintTimer = window.setTimeout(() => {
		updateFromVisual();
	}, 120);
}

async function initEditor() {
	const previewCssText = await loadPreviewCssText();
	previewCssCache = previewCssText;
	const previewDialogObserver = watchPreviewDialog(previewCssText);

	tinymce.init({
		target: visualEditorHost,
		license_key: 'gpl',
		height: '100%',
		menubar: 'file edit insert view format table',
		menu: {
			file: { title: 'File', items: 'preview | print' },
			edit: { title: 'Edit', items: 'undo redo | selectall | searchreplace' },
			insert: { title: 'Insert', items: 'link codesample | anchor' },
			view: { title: 'View', items: 'code | visualaid visualchars visualblocks | preview' },
			format: { title: 'Format', items: 'bold italic underline strikethrough superscript subscript codesample | removeformat' },
			table: { title: 'Table', items: 'inserttable | cell row column | tableprops tabledelete' }
		},
		branding: false,
		promotion: false,
		plugins: 'anchor autolink lists link code quickbars visualblocks preview searchreplace codesample visualchars table',
		quickbars_selection_toolbar: 'bold italic underline | link | bullist numlist',
		toolbar_mode: 'sliding',
		toolbar: 'undo redo | blocks | bold italic underline strikethrough | removeformat alignleft aligncenter alignright alignjustify | numlist bullist indent outdent anchor | link table codesample | code',
		block_formats: 'Paragraph=p;Blockquote=blockquote;Pre=pre',
		valid_elements: '*[*]',
		extended_valid_elements: 'pre[class|style],code[class|style]',
		verify_html: false,
		body_class: 'preview',
		entity_encoding: 'raw',
		setup(editor) {
			editor.on('remove', () => {
				previewDialogObserver.disconnect();
			});

			editor.on('init', () => {
				ensureEditorStylesheet(editor);
				applyInlineLint(editor);
				htmlSource = extractEditorHtml(editor);
				renderPreview(htmlSource);
			});

			editor.on('ExecCommand', (event) => {
				if (event.command === 'mcePreview') {
					schedulePreviewDialogStyling(previewCssCache || previewCssText);
				}
			});

			editor.on('OpenWindow', () => {
				schedulePreviewDialogStyling(previewCssCache || previewCssText);
			});

			editor.on('BeforeGetContent', () => {
				clearInlineLintMarkers(editor.getBody());
			});

			editor.on('GetContent', () => {
				scheduleInlineLint(editor);
			});

			['input', 'change', 'undo', 'redo', 'SetContent', 'NodeChange'].forEach((eventName) => {
				editor.on(eventName, () => {
					scheduleInlineLint(editor);
				});
			});
		}
	});
}

void initEditor();
