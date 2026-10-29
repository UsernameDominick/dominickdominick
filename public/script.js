const column = document.querySelector(".contentContainerL");

window.addEventListener("pointerdown", function(event) {
	if(event.target.closest(".navContainer")) {
		return;
	}

	reveal();
});

function reveal() {
	document.body.classList.add("revealed");
}

function hide() {
	document.body.classList.remove("revealed");
}

window.addEventListener("wheel", function (event) {
	if (event.deltaY > 0) {
		reveal();
	} else if (event.deltaY < 0 && column.scrollTop === 0) {
		hide();
	}
});

window.addEventListener("keydown", function (event) {
	const downKeys = ["ArrowDown", "PageDown", " ", "Enter", "Tab"];
	const upKeys = ["ArrowUp","PageUp"];

	if(downKeys.includes(event.key)) {
		reveal();
	} else if (upKeys.includes(event.key) && column.scrollTop === 0) {
		hide();
	}
});

