const panel = document.querySelector(".contentContainer");

function reveal() {
	document.body.classList.add("revealed");
}

function hide() {
	document.body.classList.remove("revealed");
}

window.addEventListener("wheel", function (event) {
	if (event.deltaY > 0) {
		reveal();
	} else if (event.deltaY < 0 && window.scrollY === 0) {
		hide();
	}
});

window.addEventListener("pointerdown", reveal);

window.addEventListener("keydown", function (event) {
	const downKeys = ["ArrowUp","PageDown"," ","Enter","Tab"];
	const upKeys = ["ArrowUp","PageUp"];

	if(downKeys.includes(event.key)) {
		reveal();
	} else if (upkeys.includes(even.key) && window.scrollY === 0) {
		hide();
	}
});

